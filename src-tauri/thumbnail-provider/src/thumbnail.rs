use std::io::Cursor;

use exr::prelude::*;

const MAX_ANALYSIS_SAMPLES: usize = 16_384;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ThumbnailImage {
    pub width: u32,
    pub height: u32,
    pub bgra: Vec<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ChannelMode {
    Rgb {
        red: usize,
        green: usize,
        blue: usize,
        alpha: Option<usize>,
    },
    Mono {
        value: usize,
        alpha: Option<usize>,
    },
}

pub fn decode_exr_thumbnail(
    bytes: &[u8],
    requested_max_edge: u32,
) -> std::result::Result<ThumbnailImage, String> {
    let image = read()
        .no_deep_data()
        .largest_resolution_level()
        .all_channels()
        .first_valid_layer()
        .all_attributes()
        .non_parallel()
        .from_buffered(Cursor::new(bytes))
        .map_err(|error| error.to_string())?;

    let layer = image.layer_data;
    let source_width = layer.size.width();
    let source_height = layer.size.height();
    if source_width == 0 || source_height == 0 {
        return Err("EXR image has an empty display size.".to_string());
    }

    let mode = resolve_channel_mode(&layer.channel_data.list)
        .ok_or_else(|| "EXR layer has no flat channels that can be thumbnailed.".to_string())?;
    let max_edge = requested_max_edge.max(1);
    let (thumb_width, thumb_height) = thumbnail_dimensions(source_width, source_height, max_edge);
    let mapper = ToneMapper::from_layer(&layer, mode);
    let mut bgra = vec![0_u8; thumb_width as usize * thumb_height as usize * 4];

    for y in 0..thumb_height as usize {
        let source_y = ((y as f64 + 0.5) * source_height as f64 / thumb_height as f64)
            .floor()
            .clamp(0.0, (source_height - 1) as f64) as usize;

        for x in 0..thumb_width as usize {
            let source_x = ((x as f64 + 0.5) * source_width as f64 / thumb_width as f64)
                .floor()
                .clamp(0.0, (source_width - 1) as f64) as usize;
            let source_index = source_y * source_width + source_x;
            let [red, green, blue, alpha] = mapper.pixel_at(&layer, mode, source_index);
            let out = (y * thumb_width as usize + x) * 4;
            bgra[out] = blue;
            bgra[out + 1] = green;
            bgra[out + 2] = red;
            bgra[out + 3] = alpha;
        }
    }

    Ok(ThumbnailImage {
        width: thumb_width,
        height: thumb_height,
        bgra,
    })
}

fn thumbnail_dimensions(source_width: usize, source_height: usize, max_edge: u32) -> (u32, u32) {
    let max_edge = max_edge.max(1) as f64;
    let scale = (max_edge / source_width.max(source_height) as f64).min(1.0);
    let width = ((source_width as f64 * scale).round() as u32).max(1);
    let height = ((source_height as f64 * scale).round() as u32).max(1);
    (width, height)
}

fn resolve_channel_mode(channels: &[AnyChannel<FlatSamples>]) -> Option<ChannelMode> {
    let red = find_channel(channels, &["R", "red"]);
    let green = find_channel(channels, &["G", "green"]);
    let blue = find_channel(channels, &["B", "blue"]);
    let alpha = find_channel(channels, &["A", "alpha"]);

    match (red, green, blue) {
        (Some(red), Some(green), Some(blue)) => Some(ChannelMode::Rgb {
            red,
            green,
            blue,
            alpha,
        }),
        _ => find_channel(channels, &["Y", "L", "luma", "luminance"])
            .or_else(|| first_full_resolution_channel(channels))
            .map(|value| ChannelMode::Mono { value, alpha }),
    }
}

fn find_channel(channels: &[AnyChannel<FlatSamples>], candidates: &[&str]) -> Option<usize> {
    channels.iter().position(|channel| {
        let component = channel_component_name(&channel.name);
        candidates
            .iter()
            .any(|candidate| component.eq_ignore_ascii_case(candidate))
    })
}

fn first_full_resolution_channel(channels: &[AnyChannel<FlatSamples>]) -> Option<usize> {
    channels.iter().position(|channel| {
        channel.sampling.x() == 1 && channel.sampling.y() == 1 && channel.sample_data.len() > 0
    })
}

fn channel_component_name(name: &Text) -> String {
    let name = name.to_string();
    name.rsplit('.').next().unwrap_or(&name).to_string()
}

struct ToneMapper {
    mode: ToneMapperMode,
}

#[derive(Debug, Clone, Copy)]
enum ToneMapperMode {
    Rgb { exposure: f32 },
    Mono { low: f32, high: f32 },
}

impl ToneMapper {
    fn from_layer(layer: &Layer<AnyChannels<FlatSamples>>, mode: ChannelMode) -> Self {
        match mode {
            ChannelMode::Rgb {
                red, green, blue, ..
            } => {
                let mut luminance = sampled_values(layer.size.area(), |index| {
                    let r = sample(layer, red, index);
                    let g = sample(layer, green, index);
                    let b = sample(layer, blue, index);
                    if r.is_finite() && g.is_finite() && b.is_finite() {
                        Some((0.2126 * r + 0.7152 * g + 0.0722 * b).max(r.max(g).max(b)))
                    } else {
                        None
                    }
                });
                luminance.sort_by(|a, b| a.total_cmp(b));
                let percentile = percentile(&luminance, 0.98).unwrap_or(1.0);
                let exposure = if percentile > 0.000_001 {
                    0.9 / percentile
                } else {
                    1.0
                };
                Self {
                    mode: ToneMapperMode::Rgb { exposure },
                }
            }
            ChannelMode::Mono { value, .. } => {
                let mut values = sampled_values(layer.size.area(), |index| {
                    let value = sample(layer, value, index);
                    value.is_finite().then_some(value)
                });
                values.sort_by(|a, b| a.total_cmp(b));
                let low = percentile(&values, 0.02).unwrap_or(0.0);
                let high = percentile(&values, 0.98).unwrap_or(1.0);
                let (low, high) = if (high - low).abs() > f32::EPSILON {
                    (low, high)
                } else {
                    (low, low + 1.0)
                };
                Self {
                    mode: ToneMapperMode::Mono { low, high },
                }
            }
        }
    }

    fn pixel_at(
        &self,
        layer: &Layer<AnyChannels<FlatSamples>>,
        mode: ChannelMode,
        index: usize,
    ) -> [u8; 4] {
        match (self.mode, mode) {
            (
                ToneMapperMode::Rgb { exposure },
                ChannelMode::Rgb {
                    red,
                    green,
                    blue,
                    alpha,
                },
            ) => [
                hdr_to_byte(sample(layer, red, index) * exposure),
                hdr_to_byte(sample(layer, green, index) * exposure),
                hdr_to_byte(sample(layer, blue, index) * exposure),
                alpha_to_byte(
                    alpha
                        .map(|alpha| sample(layer, alpha, index))
                        .unwrap_or(1.0),
                ),
            ],
            (ToneMapperMode::Mono { low, high }, ChannelMode::Mono { value, alpha }) => {
                let normalized = (sample(layer, value, index) - low) / (high - low);
                let byte = ldr_to_byte(normalized);
                [
                    byte,
                    byte,
                    byte,
                    alpha_to_byte(
                        alpha
                            .map(|alpha| sample(layer, alpha, index))
                            .unwrap_or(1.0),
                    ),
                ]
            }
            _ => [0, 0, 0, 255],
        }
    }
}

fn sampled_values<F>(len: usize, mut sample_at: F) -> Vec<f32>
where
    F: FnMut(usize) -> Option<f32>,
{
    let stride = (len / MAX_ANALYSIS_SAMPLES).max(1);
    (0..len)
        .step_by(stride)
        .filter_map(|index| sample_at(index))
        .collect()
}

fn percentile(sorted: &[f32], percentile: f32) -> Option<f32> {
    if sorted.is_empty() {
        return None;
    }

    let index = ((sorted.len() - 1) as f32 * percentile.clamp(0.0, 1.0)).round() as usize;
    sorted.get(index).copied()
}

fn sample(layer: &Layer<AnyChannels<FlatSamples>>, channel: usize, index: usize) -> f32 {
    let samples = &layer.channel_data.list[channel].sample_data;
    if index >= samples.len() {
        0.0
    } else {
        samples.value_by_flat_index(index).to_f32()
    }
}

fn hdr_to_byte(value: f32) -> u8 {
    ldr_to_byte(value.max(0.0).powf(1.0 / 2.2))
}

fn ldr_to_byte(value: f32) -> u8 {
    (value.clamp(0.0, 1.0) * 255.0).round() as u8
}

fn alpha_to_byte(value: f32) -> u8 {
    ldr_to_byte(if value.is_finite() { value } else { 1.0 })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_thumbnail_for_project_fixture() {
        let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../public/cbox_rgb.exr");
        let bytes = std::fs::read(path).expect("fixture should be readable");
        let thumbnail = decode_exr_thumbnail(&bytes, 128).expect("fixture should thumbnail");

        assert!(thumbnail.width > 0);
        assert!(thumbnail.height > 0);
        assert!(thumbnail.width <= 128);
        assert!(thumbnail.height <= 128);
        assert_eq!(
            thumbnail.bgra.len(),
            thumbnail.width as usize * thumbnail.height as usize * 4
        );
        assert!(thumbnail.bgra.chunks_exact(4).any(|pixel| pixel[3] == 255));
    }

    #[test]
    fn preserves_aspect_ratio_for_wide_images() {
        assert_eq!(thumbnail_dimensions(400, 200, 128), (128, 64));
    }

    #[test]
    fn preserves_aspect_ratio_for_tall_images() {
        assert_eq!(thumbnail_dimensions(200, 400, 128), (64, 128));
    }
}
