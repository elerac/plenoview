/*
 * Plenoview's TinyEXR v3 WebAssembly decoder.
 *
 * Decodes every flat part and every arbitrary channel into full data-window
 * planar float32 storage. Scanline blocks and level-0 tiles are decoded once;
 * subsampled channels are expanded to the data-window resolution. The JS
 * facade copies those planes out of WebAssembly before releasing this result.
 *
 * TinyEXR source pin: v3.2.0
 * Commit: 6f470c9ab24bf3992bc512ce07e8ecb00d9bf105
 */

#include "exr.h"
#include "exr_internal.h"

#include <limits.h>
#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define PEXR_EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define PEXR_EXPORT
#endif

enum pexr_failure_reason {
    PEXR_FAILURE_NONE = 0,
    PEXR_FAILURE_DEEP = 1,
    PEXR_FAILURE_DWA = 2,
    PEXR_FAILURE_INVALID_LAYOUT = 3
};

#define PEXR_MAX_THREADS 16

typedef struct pexr_channel {
    char name[EXR_MAX_NAME];
    float *pixels;
    uint32_t length;
    float finite_min;
    float finite_max;
    uint32_t finite_count;
} pexr_channel;

typedef struct pexr_part {
    char name[EXR_MAX_NAME];
    int32_t width;
    int32_t height;
    int32_t display_width;
    int32_t display_height;
    int32_t num_channels;
    pexr_channel *channels;
} pexr_part;

typedef struct pexr_image {
    int32_t width;
    int32_t height;
    int32_t num_parts;
    pexr_part *parts;
} pexr_image;

typedef struct pexr_finite_range {
    float min;
    float max;
    uint32_t count;
} pexr_finite_range;

typedef struct pexr_block_status {
    exr_result result;
    int32_t stage;
    int32_t reason;
} pexr_block_status;

typedef struct pexr_decode_part_context {
    exr_reader *reader;
    pexr_part *part;
    const exr_header *header;
    exr_block_info *block_infos;
    pexr_finite_range *block_ranges;
    pexr_block_status *block_statuses;
    int32_t part_index;
    uint32_t num_blocks;
    uint32_t warmup_block;
} pexr_decode_part_context;

static int32_t g_last_error;
static int32_t g_last_stage;
static int32_t g_last_reason;
static int32_t g_last_part;
static int32_t g_last_block;

static void record_failure(int32_t stage, exr_result error, int32_t reason,
                           int32_t part, int32_t block) {
    g_last_stage = stage;
    g_last_error = (int32_t)error;
    g_last_reason = reason;
    g_last_part = part;
    g_last_block = block;
}

static void reset_failure(void) {
    g_last_error = EXR_SUCCESS;
    g_last_stage = 0;
    g_last_reason = PEXR_FAILURE_NONE;
    g_last_part = -1;
    g_last_block = -1;
}

static void free_image(pexr_image *image);

static int64_t floor_div(int64_t value, int64_t divisor) {
    int64_t quotient = value / divisor;
    int64_t remainder = value % divisor;
    if (remainder && ((remainder < 0) != (divisor < 0))) --quotient;
    return quotient;
}

static int32_t sample_count(int32_t low, int32_t high, int32_t sampling) {
    int64_t count;
    if (sampling <= 1) return high - low + 1;
    count = floor_div(high, sampling) -
            floor_div((int64_t)low - 1, sampling);
    if (count < 0 || count > INT32_MAX) return -1;
    return (int32_t)count;
}

static int32_t first_sample_coordinate(int32_t low, int32_t sampling) {
    int64_t coordinate;
    if (sampling <= 1) return low;
    coordinate = (floor_div((int64_t)low - 1, sampling) + 1) * sampling;
    if (coordinate < INT32_MIN || coordinate > INT32_MAX) return low;
    return (int32_t)coordinate;
}

static size_t pixel_size(exr_pixel_type type) {
    return type == EXR_PIXEL_HALF ? 2u : 4u;
}

static int box_dimensions(const exr_box2i *box, int32_t *width,
                          int32_t *height) {
    int64_t w = (int64_t)box->max_x - box->min_x + 1;
    int64_t h = (int64_t)box->max_y - box->min_y + 1;
    if (w <= 0 || h <= 0 || w > INT32_MAX || h > INT32_MAX) return 0;
    *width = (int32_t)w;
    *height = (int32_t)h;
    return 1;
}

static int valid_part_index(const pexr_image *image, int32_t part) {
    return image && part >= 0 && part < image->num_parts;
}

static int valid_channel_index(const pexr_image *image, int32_t part,
                               int32_t channel) {
    return valid_part_index(image, part) && channel >= 0 &&
           channel < image->parts[part].num_channels;
}

static void update_range(pexr_finite_range *range, float value) {
    if (!isfinite(value)) return;
    if (range->count == 0) {
        range->min = value;
        range->max = value;
    } else {
        if (value < range->min) range->min = value;
        if (value > range->max) range->max = value;
    }
    ++range->count;
}

static exr_result prepare_parts(exr_reader *reader, pexr_image *image) {
    int32_t part_index;

    image->num_parts = exr_reader_num_parts(reader);
    if (image->num_parts <= 0) {
        record_failure(3, EXR_ERROR_INVALID_FILE, PEXR_FAILURE_INVALID_LAYOUT,
                       -1, -1);
        return EXR_ERROR_INVALID_FILE;
    }
    image->parts = (pexr_part *)calloc((size_t)image->num_parts,
                                       sizeof(pexr_part));
    if (!image->parts) {
        record_failure(3, EXR_ERROR_OUT_OF_MEMORY, PEXR_FAILURE_NONE, -1, -1);
        return EXR_ERROR_OUT_OF_MEMORY;
    }

    for (part_index = 0; part_index < image->num_parts; ++part_index) {
        const exr_header *header =
            exr_reader_part_header(reader, part_index);
        pexr_part *part = &image->parts[part_index];
        uint64_t pixel_count;
        int32_t channel_index;

        if (!header || header->num_channels <= 0 ||
            !box_dimensions(&header->data_window, &part->width,
                            &part->height) ||
            !box_dimensions(&header->display_window, &part->display_width,
                            &part->display_height)) {
            record_failure(3, EXR_ERROR_CORRUPT,
                           PEXR_FAILURE_INVALID_LAYOUT, part_index, -1);
            return EXR_ERROR_CORRUPT;
        }
        if (header->part_type == EXR_PART_DEEP_SCANLINE ||
            header->part_type == EXR_PART_DEEP_TILED) {
            record_failure(3, EXR_ERROR_UNSUPPORTED, PEXR_FAILURE_DEEP,
                           part_index, -1);
            return EXR_ERROR_UNSUPPORTED;
        }
        if (header->compression == EXR_COMPRESSION_DWAA ||
            header->compression == EXR_COMPRESSION_DWAB) {
            record_failure(3, EXR_ERROR_UNSUPPORTED, PEXR_FAILURE_DWA,
                           part_index, -1);
            return EXR_ERROR_UNSUPPORTED;
        }

        pixel_count = (uint64_t)(uint32_t)part->width *
                      (uint64_t)(uint32_t)part->height;
        if (pixel_count == 0 || pixel_count > UINT32_MAX ||
            pixel_count > SIZE_MAX / sizeof(float)) {
            record_failure(3, EXR_ERROR_OUT_OF_MEMORY,
                           PEXR_FAILURE_INVALID_LAYOUT, part_index, -1);
            return EXR_ERROR_OUT_OF_MEMORY;
        }

        memcpy(part->name, header->name, EXR_MAX_NAME);
        part->name[EXR_MAX_NAME - 1] = '\0';
        part->num_channels = header->num_channels;
        part->channels = (pexr_channel *)calloc(
            (size_t)part->num_channels, sizeof(pexr_channel));
        if (!part->channels) {
            record_failure(3, EXR_ERROR_OUT_OF_MEMORY, PEXR_FAILURE_NONE,
                           part_index, -1);
            return EXR_ERROR_OUT_OF_MEMORY;
        }

        for (channel_index = 0; channel_index < part->num_channels;
             ++channel_index) {
            pexr_channel *channel = &part->channels[channel_index];
            memcpy(channel->name, header->channels[channel_index].name,
                   EXR_MAX_NAME);
            channel->name[EXR_MAX_NAME - 1] = '\0';
            channel->length = (uint32_t)pixel_count;
            channel->pixels = (float *)calloc((size_t)pixel_count,
                                              sizeof(float));
            if (!channel->pixels) {
                record_failure(3, EXR_ERROR_OUT_OF_MEMORY, PEXR_FAILURE_NONE,
                               part_index, -1);
                return EXR_ERROR_OUT_OF_MEMORY;
            }
        }

        if (part_index == 0) {
            image->width = part->display_width;
            image->height = part->display_height;
        }
    }
    return EXR_SUCCESS;
}

static void set_block_failure(pexr_decode_part_context *context,
                              uint32_t block_index, int32_t stage,
                              exr_result result, int32_t reason) {
    pexr_block_status *status = &context->block_statuses[block_index];
    status->result = result;
    status->stage = stage;
    status->reason = reason;
}

static void decode_block(pexr_decode_part_context *context,
                         uint32_t block_index) {
    const exr_block_info *info = &context->block_infos[block_index];
    const exr_header *header = context->header;
    pexr_part *part = context->part;
    size_t block_pixels;
    uint8_t *block = NULL;
    uint8_t *channel_data = NULL;
    float *channel_float = NULL;
    int32_t channel_index;
    exr_result result;

    if (info->level_x != 0 || info->level_y != 0) return;
    block_pixels = (size_t)info->width * (size_t)info->height;
    block = (uint8_t *)malloc(info->uncompressed_size);
    channel_data = (uint8_t *)malloc(block_pixels * sizeof(uint32_t));
    channel_float = (float *)malloc(block_pixels * sizeof(float));
    if (!block || !channel_data || !channel_float) {
        set_block_failure(context, block_index, 6, EXR_ERROR_OUT_OF_MEMORY,
                          PEXR_FAILURE_NONE);
        goto done;
    }

    result = exr_reader_decode_block(context->reader, context->part_index,
                                     block_index, block,
                                     info->uncompressed_size);
    if (result != EXR_SUCCESS) {
        set_block_failure(context, block_index, 7, result,
                          PEXR_FAILURE_NONE);
        goto done;
    }

    for (channel_index = 0; channel_index < header->num_channels;
         ++channel_index) {
        const exr_channel *source_channel = &header->channels[channel_index];
        pexr_channel *target_channel = &part->channels[channel_index];
        pexr_finite_range *range = context->block_ranges +
            (size_t)block_index * (size_t)header->num_channels +
            (size_t)channel_index;
        int32_t x_sampling = source_channel->x_sampling > 0
            ? source_channel->x_sampling : 1;
        int32_t y_sampling = source_channel->y_sampling > 0
            ? source_channel->y_sampling : 1;
        int32_t sampled_width = sample_count(
            info->x0, info->x0 + info->width - 1, x_sampling);
        int32_t sampled_height = sample_count(
            info->y0, info->y0 + info->height - 1, y_sampling);
        int32_t first_x = first_sample_coordinate(info->x0, x_sampling);
        int32_t first_y = first_sample_coordinate(info->y0, y_sampling);
        size_t channel_samples;
        size_t sample_index;
        int32_t sampled_y;

        if (sampled_width <= 0 || sampled_height <= 0) continue;
        channel_samples = (size_t)sampled_width * (size_t)sampled_height;
        if (channel_samples > block_pixels ||
            channel_samples >
                SIZE_MAX / pixel_size(source_channel->pixel_type)) {
            set_block_failure(context, block_index, 8, EXR_ERROR_CORRUPT,
                              PEXR_FAILURE_INVALID_LAYOUT);
            goto done;
        }

        result = exr_block_extract_channel(
            header, info, block, info->uncompressed_size, channel_index,
            channel_data);
        if (result != EXR_SUCCESS) {
            set_block_failure(context, block_index, 8, result,
                              PEXR_FAILURE_NONE);
            goto done;
        }

        switch (source_channel->pixel_type) {
            case EXR_PIXEL_HALF:
                exr_half_to_float((const uint16_t *)channel_data,
                                  channel_float, channel_samples);
                break;
            case EXR_PIXEL_FLOAT:
                memcpy(channel_float, channel_data,
                       channel_samples * sizeof(float));
                break;
            case EXR_PIXEL_UINT:
                for (sample_index = 0; sample_index < channel_samples;
                     ++sample_index) {
                    channel_float[sample_index] = (float)(
                        (const uint32_t *)channel_data)[sample_index];
                }
                break;
            default:
                set_block_failure(context, block_index, 8,
                                  EXR_ERROR_UNSUPPORTED, PEXR_FAILURE_NONE);
                goto done;
        }

        if (x_sampling == 1 && y_sampling == 1) {
            for (sampled_y = 0; sampled_y < sampled_height; ++sampled_y) {
                int32_t output_y = info->y0 - header->data_window.min_y +
                    sampled_y;
                int32_t output_x = info->x0 - header->data_window.min_x;
                float *destination;
                int32_t sampled_x;
                if (output_y < 0 || output_y >= part->height ||
                    output_x < 0 ||
                    output_x + sampled_width > part->width) {
                    set_block_failure(context, block_index, 8,
                                      EXR_ERROR_CORRUPT,
                                      PEXR_FAILURE_INVALID_LAYOUT);
                    goto done;
                }
                destination = target_channel->pixels +
                    (size_t)output_y * (size_t)part->width +
                    (size_t)output_x;
                memcpy(destination,
                       channel_float +
                           (size_t)sampled_y * (size_t)sampled_width,
                       (size_t)sampled_width * sizeof(float));
                for (sampled_x = 0; sampled_x < sampled_width;
                     ++sampled_x) {
                    update_range(range, destination[sampled_x]);
                }
            }
        } else {
            for (sampled_y = 0; sampled_y < sampled_height; ++sampled_y) {
                int32_t absolute_y = first_y + sampled_y * y_sampling;
                int32_t sampled_x;
                for (sampled_x = 0; sampled_x < sampled_width;
                     ++sampled_x) {
                    int32_t absolute_x = first_x + sampled_x * x_sampling;
                    float value = channel_float[
                        (size_t)sampled_y * (size_t)sampled_width +
                        (size_t)sampled_x];
                    int32_t fill_y;
                    for (fill_y = absolute_y;
                         fill_y < absolute_y + y_sampling; ++fill_y) {
                        int32_t output_y = fill_y -
                            header->data_window.min_y;
                        int32_t fill_x;
                        if (output_y < 0 || output_y >= part->height) continue;
                        for (fill_x = absolute_x;
                             fill_x < absolute_x + x_sampling; ++fill_x) {
                            int32_t output_x = fill_x -
                                header->data_window.min_x;
                            size_t output_index;
                            if (output_x < 0 || output_x >= part->width)
                                continue;
                            output_index =
                                (size_t)output_y * (size_t)part->width +
                                (size_t)output_x;
                            target_channel->pixels[output_index] = value;
                            update_range(range, value);
                        }
                    }
                }
            }
        }
    }

done:
    free(channel_float);
    free(channel_data);
    free(block);
}

static void decode_block_after_warmup(void *opaque, int job) {
    pexr_decode_part_context *context =
        (pexr_decode_part_context *)opaque;
    uint32_t block_index = (uint32_t)job;

    if (block_index >= context->warmup_block) ++block_index;
    decode_block(context, block_index);
}

static void merge_block_ranges(pexr_decode_part_context *context) {
    int32_t channel_index;
    for (channel_index = 0; channel_index < context->header->num_channels;
         ++channel_index) {
        pexr_channel *channel = &context->part->channels[channel_index];
        uint32_t block_index;
        for (block_index = 0; block_index < context->num_blocks;
             ++block_index) {
            const pexr_finite_range *range = context->block_ranges +
                (size_t)block_index *
                    (size_t)context->header->num_channels +
                (size_t)channel_index;
            if (range->count == 0) continue;
            if (channel->finite_count == 0) {
                channel->finite_min = range->min;
                channel->finite_max = range->max;
            } else {
                if (range->min < channel->finite_min)
                    channel->finite_min = range->min;
                if (range->max > channel->finite_max)
                    channel->finite_max = range->max;
            }
            channel->finite_count += range->count;
        }
    }
}

static exr_result decode_part(exr_reader *reader, pexr_image *image,
                              int32_t part_index) {
    const exr_header *header = exr_reader_part_header(reader, part_index);
    pexr_decode_part_context context;
    uint32_t num_blocks = 0;
    uint32_t block_index;
    uint32_t warmup_block = UINT32_MAX;
    size_t range_count;
    exr_result result;

    memset(&context, 0, sizeof(context));
    result = exr_reader_num_blocks(reader, part_index, &num_blocks);
    if (result != EXR_SUCCESS || num_blocks == 0) {
        record_failure(4, result == EXR_SUCCESS ? EXR_ERROR_CORRUPT : result,
                       PEXR_FAILURE_NONE, part_index, -1);
        return result == EXR_SUCCESS ? EXR_ERROR_CORRUPT : result;
    }
    if (num_blocks > (uint32_t)INT_MAX ||
        (size_t)num_blocks > SIZE_MAX / sizeof(exr_block_info) ||
        (size_t)num_blocks > SIZE_MAX / sizeof(pexr_block_status) ||
        (size_t)header->num_channels >
            SIZE_MAX / (size_t)num_blocks / sizeof(pexr_finite_range)) {
        record_failure(6, EXR_ERROR_OUT_OF_MEMORY,
                       PEXR_FAILURE_INVALID_LAYOUT, part_index, -1);
        return EXR_ERROR_OUT_OF_MEMORY;
    }
    range_count = (size_t)num_blocks * (size_t)header->num_channels;
    context.block_infos = (exr_block_info *)calloc(
        (size_t)num_blocks, sizeof(exr_block_info));
    context.block_ranges = (pexr_finite_range *)calloc(
        range_count, sizeof(pexr_finite_range));
    context.block_statuses = (pexr_block_status *)calloc(
        (size_t)num_blocks, sizeof(pexr_block_status));
    if (!context.block_infos || !context.block_ranges ||
        !context.block_statuses) {
        result = EXR_ERROR_OUT_OF_MEMORY;
        record_failure(6, result, PEXR_FAILURE_NONE, part_index, -1);
        goto done;
    }

    for (block_index = 0; block_index < num_blocks; ++block_index) {
        exr_block_info *info = &context.block_infos[block_index];
        size_t block_pixels;
        result = exr_reader_block_info(reader, part_index, block_index, info);
        if (result != EXR_SUCCESS) {
            record_failure(5, result, PEXR_FAILURE_NONE, part_index,
                           (int32_t)block_index);
            goto done;
        }
        if (info->level_x != 0 || info->level_y != 0) continue;
        if (warmup_block == UINT32_MAX) warmup_block = block_index;
        if (info->width <= 0 || info->height <= 0 ||
            info->uncompressed_size == 0 ||
            (size_t)info->width > SIZE_MAX / (size_t)info->height) {
            result = EXR_ERROR_CORRUPT;
            record_failure(5, result, PEXR_FAILURE_INVALID_LAYOUT,
                           part_index, (int32_t)block_index);
            goto done;
        }
        block_pixels = (size_t)info->width * (size_t)info->height;
        if (block_pixels > SIZE_MAX / sizeof(float)) {
            result = EXR_ERROR_CORRUPT;
            record_failure(5, result, PEXR_FAILURE_INVALID_LAYOUT,
                           part_index, (int32_t)block_index);
            goto done;
        }
    }
    if (warmup_block == UINT32_MAX) {
        result = EXR_ERROR_CORRUPT;
        record_failure(6, result, PEXR_FAILURE_INVALID_LAYOUT,
                       part_index, -1);
        goto done;
    }

    context.reader = reader;
    context.part = &image->parts[part_index];
    context.header = header;
    context.part_index = part_index;
    context.num_blocks = num_blocks;
    context.warmup_block = warmup_block;
    /* Prime TinyEXR's lazy SIMD dispatch and the browser's WASM JIT before
     * helpers enter the same codec paths. The remaining blocks still fan out. */
    decode_block(&context, warmup_block);
    if (context.block_statuses[warmup_block].result == EXR_SUCCESS &&
        num_blocks > 1) {
        exr_parallel_for(exr_get_num_threads(), (int)num_blocks - 1,
                         decode_block_after_warmup, &context);
    }

    result = EXR_SUCCESS;
    for (block_index = 0; block_index < num_blocks; ++block_index) {
        const pexr_block_status *status =
            &context.block_statuses[block_index];
        if (status->result == EXR_SUCCESS) continue;
        result = status->result;
        record_failure(status->stage, status->result, status->reason,
                       part_index, (int32_t)block_index);
        break;
    }
    if (result == EXR_SUCCESS) merge_block_ranges(&context);

done:
    free(context.block_statuses);
    free(context.block_ranges);
    free(context.block_infos);
    return result;
}

static void free_image(pexr_image *image) {
    int32_t part_index;
    if (!image) return;
    if (image->parts) {
        for (part_index = 0; part_index < image->num_parts; ++part_index) {
            pexr_part *part = &image->parts[part_index];
            int32_t channel_index;
            if (part->channels) {
                for (channel_index = 0; channel_index < part->num_channels;
                     ++channel_index) {
                    free(part->channels[channel_index].pixels);
                }
            }
            free(part->channels);
        }
    }
    free(image->parts);
    free(image);
}

PEXR_EXPORT void pexr_set_num_threads(int32_t threads) {
    if (threads < 1) threads = 1;
    if (threads > PEXR_MAX_THREADS) threads = PEXR_MAX_THREADS;
    exr_set_num_threads((int)threads);
}

PEXR_EXPORT pexr_image *pexr_decode(const uint8_t *data, int32_t size) {
    exr_reader *reader = NULL;
    pexr_image *image = NULL;
    int32_t part_index;
    exr_result result;

    reset_failure();
    if (!data || size <= 0) {
        record_failure(1, EXR_ERROR_INVALID_ARGUMENT,
                       PEXR_FAILURE_INVALID_LAYOUT, -1, -1);
        return NULL;
    }

    result = exr_reader_open_memory(data, (size_t)size, NULL, &reader);
    if (result != EXR_SUCCESS) {
        record_failure(1, result, PEXR_FAILURE_NONE, -1, -1);
        return NULL;
    }
    result = exr_reader_parse_header(reader);
    if (result != EXR_SUCCESS) {
        record_failure(2, result, PEXR_FAILURE_NONE, -1, -1);
        goto fail;
    }

    image = (pexr_image *)calloc(1, sizeof(pexr_image));
    if (!image) {
        record_failure(3, EXR_ERROR_OUT_OF_MEMORY, PEXR_FAILURE_NONE, -1, -1);
        goto fail;
    }
    result = prepare_parts(reader, image);
    if (result != EXR_SUCCESS) goto fail;

    for (part_index = 0; part_index < image->num_parts; ++part_index) {
        result = decode_part(reader, image, part_index);
        if (result != EXR_SUCCESS) goto fail;
    }

    exr_reader_close(reader);
    return image;

fail:
    exr_reader_close(reader);
    free_image(image);
    return NULL;
}

PEXR_EXPORT int32_t pexr_width(const pexr_image *image) {
    return image ? image->width : 0;
}

PEXR_EXPORT int32_t pexr_height(const pexr_image *image) {
    return image ? image->height : 0;
}

PEXR_EXPORT int32_t pexr_num_parts(const pexr_image *image) {
    return image ? image->num_parts : 0;
}

PEXR_EXPORT const char *pexr_part_name(const pexr_image *image, int32_t part) {
    return valid_part_index(image, part) ? image->parts[part].name : NULL;
}

PEXR_EXPORT int32_t pexr_part_width(const pexr_image *image, int32_t part) {
    return valid_part_index(image, part) ? image->parts[part].width : 0;
}

PEXR_EXPORT int32_t pexr_part_height(const pexr_image *image, int32_t part) {
    return valid_part_index(image, part) ? image->parts[part].height : 0;
}

PEXR_EXPORT int32_t pexr_num_channels(const pexr_image *image, int32_t part) {
    return valid_part_index(image, part)
        ? image->parts[part].num_channels : 0;
}

PEXR_EXPORT const char *pexr_channel_name(const pexr_image *image,
                                          int32_t part, int32_t channel) {
    return valid_channel_index(image, part, channel)
        ? image->parts[part].channels[channel].name : NULL;
}

PEXR_EXPORT const float *pexr_channel_pixels(const pexr_image *image,
                                             int32_t part, int32_t channel) {
    return valid_channel_index(image, part, channel)
        ? image->parts[part].channels[channel].pixels : NULL;
}

PEXR_EXPORT uint32_t pexr_channel_length(const pexr_image *image,
                                         int32_t part, int32_t channel) {
    return valid_channel_index(image, part, channel)
        ? image->parts[part].channels[channel].length : 0;
}

PEXR_EXPORT uint32_t pexr_channel_finite_count(const pexr_image *image,
                                               int32_t part,
                                               int32_t channel) {
    return valid_channel_index(image, part, channel)
        ? image->parts[part].channels[channel].finite_count : 0;
}

PEXR_EXPORT float pexr_channel_finite_min(const pexr_image *image,
                                          int32_t part, int32_t channel) {
    return valid_channel_index(image, part, channel)
        ? image->parts[part].channels[channel].finite_min : 0.0f;
}

PEXR_EXPORT float pexr_channel_finite_max(const pexr_image *image,
                                          int32_t part, int32_t channel) {
    return valid_channel_index(image, part, channel)
        ? image->parts[part].channels[channel].finite_max : 0.0f;
}

PEXR_EXPORT int32_t pexr_last_error(void) { return g_last_error; }
PEXR_EXPORT int32_t pexr_last_stage(void) { return g_last_stage; }
PEXR_EXPORT int32_t pexr_last_reason(void) { return g_last_reason; }
PEXR_EXPORT int32_t pexr_last_part(void) { return g_last_part; }
PEXR_EXPORT int32_t pexr_last_block(void) { return g_last_block; }

PEXR_EXPORT const char *pexr_last_error_string(void) {
    return exr_result_string((exr_result)g_last_error);
}

PEXR_EXPORT void pexr_free(pexr_image *image) { free_image(image); }
