#include <mitsuba/core/bitmap.h>
#include <mitsuba/core/bsphere.h>
#include <mitsuba/core/distr_2d.h>
#include <mitsuba/core/fresolver.h>
#include <mitsuba/core/plugin.h>
#include <mitsuba/render/emitter.h>
#include <mitsuba/render/mueller.h>
#include <mitsuba/render/scene.h>
#include <mitsuba/render/texture.h>
#include <mitsuba/render/srgb.h>
#include <drjit/tensor.h>
#include <mitsuba/render/fwd.h>
#include <mitsuba/core/fstream.h>
#include <array>

NAMESPACE_BEGIN(mitsuba)

/**!

.. _emitter-penvmap:

Polarized environment emitter (:monosp:`penvmap`)
-----------------------------------------------

.. pluginparameters::
 :extra-rows: 5

 * - filename
   - |string|
   - Filename of a single OpenEXR image containing RGB layers
     :monosp:`S0`, :monosp:`S1`, and :monosp:`S2`, with channels named
     :monosp:`S0.R`, :monosp:`S0.G`, :monosp:`S0.B`, ..., :monosp:`S2.B`.
     The RGB :monosp:`S3` layer is optional and defaults to zero.

 * - bitmap
   - :monosp:`Bitmap object`
   - Alternative to :monosp:`filename`: an existing multi-channel Bitmap
     containing the same RGB Stokes layers.

 * - scale
   - |Float|
   - Scale factor applied to all Stokes components. (Default: 1.0)
   - |exposed|, |differentiable|

 * - to_world
   - |transform|
   - Emitter-to-world rotation, applied to both directions and Stokes reference
     bases. (Default: identity)
   - |exposed|

 * - mis_compensation
   - |bool|
   - Compensate sampling for the presence of other Monte Carlo techniques that
     will be combined using multiple importance sampling (MIS)? This is
     extremely cheap to do and can slightly reduce variance. (Default: false)

 * - data
   - |tensor|
   - Traversed radiance tensor with shape :math:`[H, W+1, 4, 3]`. Axis 2 stores
     :math:`\mathbf{s}_0` through :math:`\mathbf{s}_3`; the last column is a
     periodic copy of the first real column. This is an editable scene
     parameter, not a constructor input.
   - |exposed|, |differentiable|, |discontinuous|

This plugin provides a polarized HDRI (high dynamic range imaging) environment
map for infinitely distant illumination in latitude-longitude format.

Specify exactly one input: a multi-channel OpenEXR :monosp:`filename` or an
existing :monosp:`bitmap` with the same named RGB layers. Linear polarization
maps may omit :monosp:`S3`; the plugin assumes zero circular polarization.
:monosp:`S0`, :monosp:`S1`, and :monosp:`S2` are always required, and a supplied
:monosp:`S3` layer must contain RGB data. All input components share the
image's dimensions. Images smaller than 2x3 pixels are
padded by repeating edge pixels across every channel. Combine separate
research images into a multi-channel Bitmap before constructing the emitter.

Polarized variants use all four Stokes components. Nonpolarized variants
evaluate only the intensity component; spectral variants are not supported.
Signed values in :math:`\mathbf{s}_1` through
:math:`\mathbf{s}_3` are preserved. Importance sampling uses only the luminance
of :math:`\mathbf{s}_0`.

For an environment direction :math:`\mathbf{d}` pointing from the scene toward
the map, the input Stokes vector uses Mitsuba's implicit reference basis
:monosp:`mueller::stokes_basis(-d)` in emitter-local space. The minus sign is
the direction of light propagation toward the scene. :monosp:`to_world`
rotates both this basis and the direction into world space. Set camera
orientation on the sensor; Mitsuba's :monosp:`stokes` integrator expresses
rendered Stokes components in the sensor basis.

In :monosp:`data`, :math:`H` and :math:`W` are the image dimensions after any
minimum-size padding. The tensor always stores all four Stokes components,
including the zero-filled :monosp:`S3` component for a linear-only input.
Edit the first :math:`W` real columns, then call
:monosp:`SceneParameters.update()`. The plugin regenerates column :math:`W`
from column 0 without modifying real pixels. Its gradient is routed to the
first real column; independent edits to the duplicate column are ignored.
Updated tensors must retain four Stokes components and three RGB channels,
with at least three rows and three stored columns.

The latitude-longitude mapping conventions are shown below:

.. subfigstart::
.. subfigure:: ../../resources/data/docs/images/emitter/emitter_envmap_example.jpg
   :caption: The museum environment map by Bernhard Vogl that is used in
             many example renderings in this documentation.
.. subfigure:: ../../resources/data/docs/images/emitter/emitter_envmap_axes.jpg
   :caption: Coordinate conventions for mapping the image onto the sphere.
.. subfigend::
   :label: fig-penvmap-mapping

.. tabs::
    .. code-tab:: xml
        :name: penvmap-light

        <emitter type="penvmap">
            <string name="filename" value="textures/museum_stokes.exr"/>
        </emitter>

    .. code-tab:: python

        stokes_bitmap = mi.Bitmap('textures/museum_stokes.exr')

        emitter = mi.load_dict({
            'type': 'penvmap',
            'bitmap': stokes_bitmap,
        })

 */

template <typename Float, typename Spectrum>
class PolarizedEnvironmentMapEmitter final : public Emitter<Float, Spectrum> {
public:
    MI_IMPORT_BASE(Emitter, m_flags, m_to_world)
    MI_IMPORT_TYPES(Scene, Shape, Texture)

    using Warp = Hierarchical2D<Float, 0>;

    static constexpr uint32_t StokesCount = 4;
    static constexpr uint32_t RequiredStokesCount = 3;
    static constexpr uint32_t PixelWidth = is_spectral_v<Spectrum> ? 4 : 3;
    using PixelData = dr::Array<Float, PixelWidth>;
    using ScalarPixelData = dr::Array<ScalarFloat, PixelWidth>;

    PolarizedEnvironmentMapEmitter(const Properties &props) : Base(props) {
        // Spectral branches retain envmap's template structure for compilation,
        // but signed Stokes spectral upsampling is not defined by this plugin.
        if constexpr (is_spectral_v<Spectrum>)
            Throw("spectral variants are not supported yet.");

        /* Until `set_scene` is called, we have no information
           about the scene and default to the unit bounding sphere. */
        m_bsphere = BoundingSphere3f(ScalarPoint3f(0.f), 1.f);

        bool has_filename = props.has_property("filename");
        bool has_bitmap = props.has_property("bitmap");
        if (has_filename == has_bitmap)
            Throw("Specify exactly one of \"filename\" or \"bitmap\".");

        ref<Bitmap> bitmap;
        if (has_bitmap) {
            ref<Object> other = props.get<ref<Object>>("bitmap");
            Bitmap *b = dynamic_cast<Bitmap *>(other.get());
            if (!b)
                Throw("Property \"bitmap\" must be a Bitmap instance.");
            bitmap = b;
        } else {
            FileResolver *fs = file_resolver();
            fs::path file_path =
                fs->resolve(props.get<std::string_view>("filename"));
            m_filename = file_path.filename().string();
            bitmap = new Bitmap(file_path);
        }

        bitmap = bitmap->pad_to(ScalarVector2u(2, 3));
        std::array<ref<Bitmap>, StokesCount> bitmaps {};
        const std::string name = m_filename.empty() ? "<Bitmap>" : m_filename;

        for (const auto &[prefix, layer] : bitmap->split()) {
            if (prefix == "<root>")
                continue;

            int layer_index = -1;
            for (uint32_t i = 0; i < StokesCount; ++i) {
                if (prefix == "S" + std::to_string(i)) {
                    layer_index = (int) i;
                    break;
                }
            }

            if (layer_index == -1)
                Throw("\"%s\": unexpected layer \"%s\". "
                      "Expected S0, S1, S2, or S3.", name, prefix);

            if (bitmaps[layer_index])
                Throw("\"%s\": duplicate layer \"%s\".", name, prefix);

            Bitmap::PixelFormat pixel_format = layer->pixel_format();
            if (pixel_format != Bitmap::PixelFormat::RGB &&
                pixel_format != Bitmap::PixelFormat::RGBA)
                Throw("\"%s\": layer \"%s\" must contain RGB data.",
                      name, prefix);

            bitmaps[layer_index] = layer;
        }

        for (uint32_t i = 0; i < RequiredStokesCount; ++i) {
            if (!bitmaps[i])
                Throw("\"%s\": missing required layer \"S%u\".", name, i);
        }

        ScalarVector2u res(bitmap->width() + 1, bitmap->height());
        // Value-initialization supplies zero S3 when that layer is absent.
        std::vector<ScalarFloat> packed_data(
            (size_t) res.x() * res.y() * StokesCount * PixelWidth);

        for (uint32_t i = 0; i < StokesCount; ++i) {
            ref<Bitmap> layer = bitmaps[i];
            if (!layer)
                continue;

            /* Convert to linear RGBA float bitmap, will undergo further
               conversion into spectral coefficients in the retained
               spectral template branches below. */
            Bitmap::PixelFormat pixel_format = Bitmap::PixelFormat::RGB;
            if constexpr (is_spectral_v<Spectrum>)
                pixel_format = Bitmap::PixelFormat::RGBA;
            layer = layer->convert(pixel_format, struct_type_v<Float>, false);

            ScalarFloat *in_ptr = (ScalarFloat *) layer->data();

            for (size_t y = 0; y < layer->size().y(); ++y) {
                for (size_t x = 0; x < layer->size().x(); ++x) {
                    ScalarColor3f rgb = dr::load<ScalarVector3f>(in_ptr);
                    ScalarFloat lum = luminance(rgb);

                    ScalarPixelData coeff;
                    if constexpr (is_monochromatic_v<Spectrum>) {
                        coeff = ScalarPixelData(lum);
                    } else if constexpr (is_rgb_v<Spectrum>) {
                        coeff = rgb;
                    } else {
                        static_assert(is_spectral_v<Spectrum>);
                        /* Retained envmap scaffolding; spectral construction
                           is rejected above. Scale to a reflectance range
                           before evaluating the upsampling model. */
                        ScalarFloat scale = dr::max(dr::abs(rgb)) * 2.f;
                        ScalarColor3f rgb_norm =
                            rgb / dr::maximum(1e-8f, scale);
                        coeff = dr::concat(
                            (ScalarColor3f)
                                srgb_model_fetch(dr::abs(rgb_norm)) *
                                dr::sign(rgb_norm),
                            dr::Array<ScalarFloat, 1>(scale));
                    }

                    ScalarFloat *dst = packed_data.data() +
                        packed_scalar_offset(y * (size_t) res.x() + x, i);
                    dr::store(dst, coeff);
                    in_ptr += PixelWidth;
                }
            }
        }

        // parameters_changed() fills the periodic column from the real pixels.
        size_t shape[4] = { (size_t) res.y(), (size_t) res.x(),
                            StokesCount, PixelWidth };
        m_data = TensorXf(packed_data.data(), 4, shape);

        m_scale = props.get<ScalarFloat>("scale", 1.f);
        m_mis_compensation = props.get<bool>("mis_compensation", false);
        m_d65 = Texture::D65(1.f);
        m_flags = EmitterFlags::Infinite | EmitterFlags::SpatiallyVarying;

        parameters_changed({"data"});
    }

    void traverse(TraversalCallback *cb) override {
        Base::traverse(cb);
        cb->put("scale",    m_scale,    ParamFlags::Differentiable);
        cb->put("data",     m_data,
                ParamFlags::Differentiable | ParamFlags::Discontinuous);
        cb->put("to_world", m_to_world, ParamFlags::NonDifferentiable);
    }

    void parameters_changed(
        const std::vector<std::string> &keys = {}) override {
        if (keys.empty() || string::contains(keys, "data")) {
            if (m_data.ndim() != 4)
                Throw("Environment map data has dimension %lu, expected 4",
                      m_data.ndim());

            if (m_data.shape(2) != StokesCount)
                Throw("Environment map data has %lu Stokes channels, "
                      "expected %u", m_data.shape(2), StokesCount);

            if (m_data.shape(3) != PixelWidth)
                Throw("Environment map data has %lu channels, expected %u",
                      m_data.shape(3), PixelWidth);

            ScalarVector2u res = resolution();
            if (res.x() < 3 || res.y() < 3)
                Throw("Environment map data must have at least 3x3 entries "
                      "including the periodic column.");

            if constexpr (dr::is_jit_v<Float>) {
                // Real pixels own the seam. Scatter into a copy so gradients
                // from the duplicate return to the first real column, while
                // preserving the caller's original differentiable tensor.
                auto &array = m_data.array();
                Float corrected = array;
                UInt32 row_stokes =
                    dr::arange<UInt32>(res.y() * StokesCount);
                UInt32 row_index =
                    (row_stokes / StokesCount) * (res.x() * StokesCount) +
                    row_stokes % StokesCount;
                UInt32 boundary_offset = UInt32((res.x() - 1) * StokesCount);
                dr::scatter(corrected,
                            dr::gather<PixelData>(array, row_index),
                            row_index + boundary_offset);

                size_t shape[4] = { (size_t) res.y(), (size_t) res.x(),
                                    StokesCount, PixelWidth };
                m_data = TensorXf(corrected, 4, shape);
            } else {
                refresh_periodic_column(
                    (ScalarFloat *) m_data.array().data(), res);
            }

            auto &&data = dr::migrate(m_data.array(), JitBackend::None);

            if constexpr (dr::is_jit_v<Float>)
                dr::sync_thread();

            rebuild_distribution((ScalarFloat *) data.data());
        }

        Base::parameters_changed(keys);
    }

    void set_scene(const Scene *scene) override {
        if (scene->bbox().valid()) {
            ScalarBoundingSphere3f scene_sphere =
                scene->bbox().bounding_sphere();
            m_bsphere =
                BoundingSphere3f(scene_sphere.center, scene_sphere.radius);
            m_bsphere.radius =
                dr::maximum(math::RayEpsilon<Float>,
                        m_bsphere.radius * (1.f + math::RayEpsilon<Float>));
        } else {
            m_bsphere.center = 0.f;
            m_bsphere.radius = math::RayEpsilon<Float>;
        }

        dr::make_opaque(m_bsphere.center, m_bsphere.radius);
    }

    Spectrum eval(const SurfaceInteraction3f &si, Mask active) const override {
        MI_MASKED_FUNCTION(ProfilerPhase::EndpointEvaluate, active);

        Vector3f d_local = m_to_world.value().inverse() * (-si.wi);

        Point2f uv = direction_to_uv(d_local);

        Vector3f forward_local = -d_local,
                 forward_world = m_to_world.value() * forward_local;

        return eval_spectrum_world(uv, si.wavelengths,
                                   forward_local, forward_world,
                                   active);
    }

    std::pair<Ray3f, Spectrum> sample_ray(Float time, Float wavelength_sample,
                                          const Point2f &sample2,
                                          const Point2f &sample3,
                                          Mask active) const override {
        MI_MASKED_FUNCTION(ProfilerPhase::EndpointSampleRay, active);

        // 1. Sample spatial component
        Point2f offset = warp::square_to_uniform_disk_concentric(sample2);

        // 2. Sample directional component
        auto [uv, pdf] = m_warp.sample(sample3, nullptr, active);
        uv.x() += half_texel();

        active &= pdf > 0.f;

        Vector3f d = uv_to_direction(uv);

        Float inv_sin_theta = dr::safe_rsqrt(dr::maximum(
            dr::square(d.x()) + dr::square(d.z()),
            dr::square(dr::Epsilon<Float>)));
        pdf *= inv_sin_theta * dr::InvTwoPi<Float> * dr::InvPi<Float>;

        // Unlike sample_direction, the ray goes from the map toward the scene.
        Vector3f d_global = m_to_world.value() * -d;

        // Compute ray origin
        Vector3f perpendicular_offset =
            Frame3f(d).to_world(Vector3f(offset.x(), offset.y(), 0));
        Point3f origin = m_bsphere.center +
            (perpendicular_offset - d_global) * m_bsphere.radius;

        // 3. Sample spectral component (weight accounts for radiance)
        auto [wavelengths, weight] =
            sample_wavelengths(uv, -d, d_global, time,
                               wavelength_sample, active);

        Float r2 = dr::square(m_bsphere.radius);
        Ray3f ray(origin, d_global, time, wavelengths);
        weight *= dr::Pi<Float> * r2 / pdf;

        return std::make_pair(ray, weight & active);
    }

    std::pair<DirectionSample3f, Spectrum>
    sample_direction(const Interaction3f &it, const Point2f &sample,
                     Mask active) const override {
        MI_MASKED_FUNCTION(ProfilerPhase::EndpointSampleDirection, active);

        auto [uv, pdf] = m_warp.sample(sample, nullptr, active);
        uv.x() += half_texel();
        active &= pdf > 0.f;

        Vector3f d_local = uv_to_direction(uv);

        // The reference can be on a sensor outside the scene bounding box.
        Float radius =
            dr::maximum(m_bsphere.radius, dr::norm(it.p - m_bsphere.center));
        Float dist = 2.f * radius;

        Float inv_sin_theta = dr::safe_rsqrt(dr::maximum(
            dr::square(d_local.x()) + dr::square(d_local.z()),
            dr::square(dr::Epsilon<Float>)));

        Vector3f d = m_to_world.value() * d_local;

        DirectionSample3f ds;
        ds.p       = it.p + d * dist;
        ds.n       = -d;
        ds.uv      = uv;
        ds.time    = it.time;
        ds.pdf     = dr::select(
            active,
            pdf * inv_sin_theta * (1.f / (2.f * dr::square(dr::Pi<Float>))),
            0.f
        );
        ds.delta   = false;
        ds.emitter = this;
        ds.d       = d;
        ds.dist    = dist;

        auto weight =
            eval_spectrum_world(uv, it.wavelengths,
                                -d_local, -d,
                                active) /
            ds.pdf;

        return { ds, weight & active };
    }

    Float pdf_direction(const Interaction3f & /*it*/,
                        const DirectionSample3f &ds,
                        Mask active) const override {
        MI_MASKED_FUNCTION(ProfilerPhase::EndpointEvaluate, active);

        Vector3f d = m_to_world.value().inverse() * ds.d;

        Point2f uv = direction_to_uv(d);
        uv.x() -= half_texel();
        uv.x() -= dr::floor(uv.x());
        uv.y() = dr::clip(uv.y(), 0.f, 1.f);

        Float inv_sin_theta = dr::safe_rsqrt(dr::maximum(
            dr::square(d.x()) + dr::square(d.z()),
            dr::square(dr::Epsilon<Float>)));

        return m_warp.eval(uv) * inv_sin_theta *
               (1.f / (2.f * dr::square(dr::Pi<Float>)));
    }

    Spectrum eval_direction(const Interaction3f &it,
                            const DirectionSample3f &ds,
                            Mask active) const override {
        MI_MASKED_FUNCTION(ProfilerPhase::EndpointEvaluate, active);

        Vector3f forward_world = -ds.d,
                 forward_local = m_to_world.value().inverse() * forward_world;

        return eval_spectrum_world(ds.uv, it.wavelengths,
                                   forward_local, forward_world,
                                   active);
    }

    std::pair<Wavelength, Spectrum>
    sample_wavelengths(const SurfaceInteraction3f &si, Float sample,
                       Mask active) const override {
        Vector3f d_local = uv_to_direction(si.uv);

        return sample_wavelengths(si.uv,
                                  -d_local,
                                  m_to_world.value() * (-d_local),
                                  si.time,
                                  sample,
                                  active);
    }

    std::pair<PositionSample3f, Float>
    sample_position(Float /*time*/, const Point2f & /*sample*/,
                    Mask /*active*/) const override {
        if constexpr (dr::is_jit_v<Float>) {
            /* Do not throw an exception in JIT-compiled variants. This
               function might be invoked by DrJit's virtual function call
               recording mechanism despite not influencing any actual
               calculation. */
            return { dr::zeros<PositionSample3f>(), dr::NaN<Float> };
        } else {
            NotImplementedError("sample_position");
        }
    }

    ScalarBoundingBox3f bbox() const override {
        /* This emitter does not occupy any particular region
           of space, return an invalid bounding box */
        return ScalarBoundingBox3f();
    }

    std::string to_string() const override {
        ScalarVector2u res = resolution() - ScalarVector2u(1, 0);
        std::ostringstream oss;
        oss << "PolarizedEnvironmentMapEmitter[" << std::endl;
        if (!m_filename.empty())
            oss << "  filename = \"" << m_filename << "\"," << std::endl;
        oss << "  res = \"" << res << "\"," << std::endl
            << "  bsphere = " << string::indent(m_bsphere) << std::endl
            << "]";
        return oss.str();
    }

protected:
    static UInt32 packed_stokes_index(const UInt32 &spatial_index,
                                      uint32_t stokes_i) {
        return dr::fmadd(spatial_index, UInt32(StokesCount), UInt32(stokes_i));
    }

    static size_t packed_scalar_offset(size_t spatial_index, size_t stokes_i) {
        return (spatial_index * StokesCount + stokes_i) * PixelWidth;
    }

    /// Stored resolution includes one periodic column after the real pixels.
    ScalarVector2u resolution() const {
        return { (uint32_t) m_data.shape(1), (uint32_t) m_data.shape(0) };
    }

    /// Align the width W+1 sampling grid with the W real texel centers.
    ScalarFloat half_texel() const { return .5f / (resolution().x() - 1u); }

    /// Convert latitude-longitude coordinates to an emitter-local direction.
    Vector3f uv_to_direction(const Point2f &uv) const {
        Float theta = uv.y() * dr::Pi<Float>,
              phi   = uv.x() * dr::TwoPi<Float>;

        Vector3f d = dr::sphdir(theta, phi);
        return Vector3f(d.y(), d.z(), -d.x());
    }

    /// Inverse of uv_to_direction, before periodic wrapping or latitude clamp.
    Point2f direction_to_uv(const Vector3f &d) const {
        return Point2f(dr::atan2(d.x(), -d.z()) * dr::InvTwoPi<Float>,
                       dr::safe_acos(d.y()) * dr::InvPi<Float>);
    }

    /// Copy the first real column into the periodic column for every Stokes
    /// component of a host-resident (H, W+1, StokesCount, PixelWidth) tensor.
    static void refresh_periodic_column(ScalarFloat *data,
                                         const ScalarVector2u &res) {
        for (size_t y = 0; y < res.y(); ++y) {
            size_t row = y * (size_t) res.x();
            for (uint32_t i = 0; i < StokesCount; ++i) {
                const ScalarFloat *src = data + packed_scalar_offset(row, i);
                ScalarFloat *dst = data +
                    packed_scalar_offset(row + res.x() - 1u, i);
                dr::store(dst, dr::load<ScalarPixelData>(src));
            }
        }
    }

    /// Build sampling weights from S0 only, preserving signed S1-S3 values.
    /// Used for both construction and subsequent edits to the packed tensor.
    void rebuild_distribution(const ScalarFloat *data) {
        ScalarVector2u res = resolution();
        std::unique_ptr<ScalarFloat[]> luminance_data(
            new ScalarFloat[(size_t) res.x() * res.y()]);

        for (size_t y = 0; y < res.y(); ++y) {
            for (size_t x = 0; x < res.x(); ++x) {
                ScalarPixelData coeff = dr::load<ScalarPixelData>(
                    data + packed_scalar_offset(y * (size_t) res.x() + x, 0));
                ScalarFloat lum;
                if constexpr (is_monochromatic_v<Spectrum>)
                    lum = coeff.x();
                else if constexpr (is_rgb_v<Spectrum>)
                    lum = luminance(ScalarColor3f(coeff));
                else
                    lum = srgb_model_mean(dr::head<3>(coeff)) * coeff.w();
                luminance_data[y * res.x() + x] = lum;
            }
        }

        // MIS compensation follows upstream envmap. Exclude the duplicated
        // periodic column when computing the mean and minimum luminance.
        ScalarFloat offset = 0.f;
        if (m_mis_compensation) {
            ScalarFloat min_lum = dr::Infinity<ScalarFloat>;
            double lum_accum = 0.0;
            for (size_t y = 0; y < res.y(); ++y) {
                for (size_t x = 0; x < res.x() - 1u; ++x) {
                    ScalarFloat lum = luminance_data[y * res.x() + x];
                    min_lum = dr::minimum(min_lum, lum);
                    lum_accum += (double) lum;
                }
            }
            offset = ScalarFloat(
                lum_accum / ((res.x() - 1u) * (size_t) res.y()));
            if (offset - min_lum <= 0.01f * offset)
                offset = 0.f;
        }

        ScalarFloat theta_scale = dr::Pi<ScalarFloat> / (res.y() - 1u);
        for (size_t y = 0; y < res.y(); ++y) {
            ScalarFloat sin_theta = dr::maximum(dr::sin(y * theta_scale), 0.f);
            for (size_t x = 0; x < res.x(); ++x) {
                ScalarFloat &lum = luminance_data[y * res.x() + x];
                lum = dr::maximum(lum - offset, 0.f) * sin_theta;
            }
        }
        m_warp = Warp(luminance_data.get(), res);
    }

    /// Interpolate a single signed RGB/mono Stokes component in emitter space.
    UnpolarizedSpectrum eval_stokes_component(
        Point2f uv, const Wavelength &wavelengths, Mask active,
        bool include_whitepoint = true, uint32_t stokes_i = 0) const {
        ScalarVector2u res = resolution();

        uv.x() -= half_texel();
        uv.x() -= dr::floor(uv.x());
        uv.y() = dr::clip(uv.y(), 0.f, 1.f);
        uv *= Vector2f(res - 1u);

        Point2u pos = dr::minimum(Point2u(uv), res - 2u);

        Point2f w1 = uv - Point2f(pos),
                w0 = 1.f - w1;

        const uint32_t width = res.x();
        UInt32 index = dr::fmadd(pos.y(), UInt32(width), UInt32(pos.x()));
        UInt32 packed_index = packed_stokes_index(index, stokes_i);
        UInt32 col_stride = UInt32(StokesCount);
        UInt32 row_stride = UInt32(width * StokesCount);

        PixelData v00 =
            dr::gather<PixelData>(m_data.array(), packed_index, active);
        PixelData v10 = dr::gather<PixelData>(
            m_data.array(), packed_index + col_stride, active);
        PixelData v01 = dr::gather<PixelData>(
            m_data.array(), packed_index + row_stride, active);
        PixelData v11 = dr::gather<PixelData>(
            m_data.array(), packed_index + row_stride + col_stride, active);

        if constexpr (is_spectral_v<Spectrum>) {
            UnpolarizedSpectrum s00, s10, s01, s11, s0, s1, s;
            Float f0, f1, f;

            s00 = srgb_model_eval<UnpolarizedSpectrum>(dr::head<3>(v00),
                                                       wavelengths);
            s10 = srgb_model_eval<UnpolarizedSpectrum>(dr::head<3>(v10),
                                                       wavelengths);
            s01 = srgb_model_eval<UnpolarizedSpectrum>(dr::head<3>(v01),
                                                       wavelengths);
            s11 = srgb_model_eval<UnpolarizedSpectrum>(dr::head<3>(v11),
                                                       wavelengths);

            s0  = dr::fmadd(w0.x(), s00, w1.x() * s10);
            s1  = dr::fmadd(w0.x(), s01, w1.x() * s11);
            f0  = dr::fmadd(w0.x(), v00.w(), w1.x() * v10.w());
            f1  = dr::fmadd(w0.x(), v01.w(), w1.x() * v11.w());

            s   = dr::fmadd(w0.y(), s0, w1.y() * s1);
            f   = dr::fmadd(w0.y(), f0, w1.y() * f1);

            UnpolarizedSpectrum result = s * f * m_scale;

            if (include_whitepoint) {
                SurfaceInteraction3f si = dr::zeros<SurfaceInteraction3f>();
                si.wavelengths = wavelengths;
                result *= m_d65->eval(si, active);
            }

            return result;
        } else {
            DRJIT_MARK_USED(wavelengths);
            PixelData v0 = dr::fmadd(w0.x(), v00, w1.x() * v10),
                      v1 = dr::fmadd(w0.x(), v01, w1.x() * v11),
                      v  = dr::fmadd(w0.y(), v0, w1.y() * v1);

            if constexpr (is_monochromatic_v<Spectrum>)
                return dr::head<1>(v) * m_scale;
            else
                return v * m_scale;
        }
    }

    Spectrum eval_spectrum_local(
        Point2f uv, const Wavelength &wavelengths, Mask active,
        bool include_whitepoint = true) const {
        if constexpr (is_polarized_v<Spectrum>) {
            Spectrum result(0.f);
            for (uint32_t i = 0; i < StokesCount; ++i) {
                UnpolarizedSpectrum value = eval_stokes_component(
                    uv, wavelengths, active, include_whitepoint, i);
                result(i, 0) = value;
            }
            return result;
        } else {
            return eval_stokes_component(
                uv, wavelengths, active, include_whitepoint);
        }
    }

    Spectrum rotate_stokes_to_world(const Spectrum &value,
                                    const Vector3f &forward_local,
                                    const Vector3f &forward_world) const {
        if constexpr (is_polarized_v<Spectrum>) {
            Vector3f local_forward = dr::normalize(forward_local),
                     world_forward = dr::normalize(forward_world);

            Vector3f basis_current = m_to_world.value() *
                                    mueller::stokes_basis(local_forward);
            Vector3f basis_target = mueller::stokes_basis(world_forward);

            return mueller::rotate_stokes_basis(world_forward,
                                                basis_current,
                                                basis_target) * value;
        } else {
            DRJIT_MARK_USED(forward_local);
            DRJIT_MARK_USED(forward_world);
            return value;
        }
    }

    Spectrum eval_spectrum_world(Point2f uv, const Wavelength &wavelengths,
                                 const Vector3f &forward_local,
                                 const Vector3f &forward_world,
                                 Mask active,
                                 bool include_whitepoint = true) const {
        Spectrum value =
            eval_spectrum_local(uv, wavelengths, active, include_whitepoint);
        return rotate_stokes_to_world(value, forward_local, forward_world);
    }

    std::pair<Wavelength, Spectrum>
    sample_wavelengths(Point2f uv,
                       const Vector3f &forward_local,
                       const Vector3f &forward_world,
                       Float time,
                       Float sample,
                       Mask active) const {
        SurfaceInteraction3f si = dr::zeros<SurfaceInteraction3f>();
        si.time = time;

        auto [wavelengths, weight] = m_d65->sample_spectrum(
            si, math::sample_shifted<Wavelength>(sample), active);

        return { wavelengths,
                 weight * eval_spectrum_world(uv, wavelengths,
                                              forward_local, forward_world,
                                              active, false) };
    }

    MI_DECLARE_CLASS(PolarizedEnvironmentMapEmitter)
protected:
    std::string m_filename;
    bool m_mis_compensation;
    BoundingSphere3f m_bsphere;
    TensorXf m_data;
    Warp m_warp;
    ref<Texture> m_d65;
    Float m_scale;

    MI_TRAVERSE_CB(Base, m_bsphere, m_data, m_warp, m_d65, m_scale)
};

MI_EXPORT_PLUGIN(PolarizedEnvironmentMapEmitter)
NAMESPACE_END(mitsuba)
