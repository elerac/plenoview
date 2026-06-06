from __future__ import annotations

import re
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
import OpenImageIO as oiio


SCENE_URL = "https://vision.middlebury.edu/stereo/data/scenes2021/data/chess1"
RAW_DIR = Path("output/middlebury_chess1_raw")
OUTPUT_PATH = Path("public/middlebury_chess1_rgb_p.exr")
OUTPUT_SCALE = 0.5
POSITION_CHANNEL_NAMES = ("P.X", "P.Y", "P.Z")

DOWNLOADS = {
    "im0.png": f"{SCENE_URL}/im0.png",
    "disp0.pfm": f"{SCENE_URL}/disp0.pfm",
    "calib.txt": f"{SCENE_URL}/calib.txt",
}


@dataclass(frozen=True)
class CameraCalibration:
    fx: float
    fy: float
    cx: float
    cy: float
    baseline_mm: float
    doffs_px: float


def download_if_missing(path: Path, url: str) -> None:
    if path.exists() and path.stat().st_size > 0:
        print(f"Using cached {path}")
        return

    path.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {url}")
    urllib.request.urlretrieve(url, path)


def read_rgb_png(path: Path) -> np.ndarray:
    bgr = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if bgr is None:
        raise RuntimeError(f"Failed to read RGB image: {path}")

    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
    return (rgb.astype(np.float32) / 255.0).astype(np.float32)


def _read_non_comment_line(file_obj) -> str:
    while True:
        line = file_obj.readline()
        if not line:
            raise ValueError("Unexpected end of PFM file")

        text = line.decode("ascii").strip()
        if text and not text.startswith("#"):
            return text


def read_pfm(path: Path) -> np.ndarray:
    with path.open("rb") as file_obj:
        header = _read_non_comment_line(file_obj)
        if header not in {"Pf", "PF"}:
            raise ValueError(f"Unsupported PFM header {header!r} in {path}")

        dimensions = _read_non_comment_line(file_obj).split()
        if len(dimensions) != 2:
            raise ValueError(f"Invalid PFM dimensions in {path}: {dimensions}")

        width, height = (int(value) for value in dimensions)
        scale = float(_read_non_comment_line(file_obj))
        dtype = "<f4" if scale < 0 else ">f4"
        channels = 1 if header == "Pf" else 3
        expected_values = width * height * channels

        data = np.fromfile(file_obj, dtype=dtype, count=expected_values)
        if data.size != expected_values:
            raise ValueError(f"Expected {expected_values} PFM values in {path}, got {data.size}")

    shape = (height, width) if channels == 1 else (height, width, channels)
    image = data.reshape(shape)
    return np.flipud(image).astype(np.float32)


def parse_calibration(path: Path) -> CameraCalibration:
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or "=" not in line:
            continue

        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()

    cam0 = values.get("cam0")
    if cam0 is None:
        raise ValueError(f"Missing cam0 in {path}")

    matrix_values = [float(value) for value in re.findall(r"[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?", cam0)]
    if len(matrix_values) != 9:
        raise ValueError(f"Expected 9 cam0 matrix values in {path}, got {len(matrix_values)}")

    return CameraCalibration(
        fx=matrix_values[0],
        fy=matrix_values[4],
        cx=matrix_values[2],
        cy=matrix_values[5],
        baseline_mm=float(values["baseline"]),
        doffs_px=float(values["doffs"]),
    )


def disparity_to_depth_m(disparity: np.ndarray, calibration: CameraCalibration) -> np.ndarray:
    denominator = disparity + np.float32(calibration.doffs_px)
    valid = np.isfinite(disparity) & (denominator > 0.0)

    depth = np.full(disparity.shape, np.nan, dtype=np.float32)
    depth[valid] = (
        calibration.baseline_mm * calibration.fx / denominator[valid] / 1000.0
    ).astype(np.float32)
    return depth


def depth_to_position_m(depth_m: np.ndarray, calibration: CameraCalibration) -> np.ndarray:
    if depth_m.ndim != 2:
        raise ValueError(f"Expected HxW depth array, got {depth_m.shape}")
    if calibration.fx <= 0.0 or calibration.fy <= 0.0:
        raise ValueError(f"Expected positive focal lengths, got fx={calibration.fx}, fy={calibration.fy}")

    height, width = depth_m.shape
    x_centers = (np.arange(width, dtype=np.float32) + np.float32(0.5))[np.newaxis, :]
    y_centers = (np.arange(height, dtype=np.float32) + np.float32(0.5))[:, np.newaxis]
    valid = np.isfinite(depth_m) & (depth_m > 0.0)

    position = np.full((height, width, 3), np.nan, dtype=np.float32)
    position[:, :, 0] = (x_centers - np.float32(calibration.cx)) * depth_m / np.float32(calibration.fx)
    position[:, :, 1] = (np.float32(calibration.cy) - y_centers) * depth_m / np.float32(calibration.fy)
    position[:, :, 2] = depth_m
    position[~valid] = np.nan
    return position.astype(np.float32)


def scaled_size(width: int, height: int, scale: float) -> tuple[int, int]:
    if not np.isfinite(scale) or scale <= 0.0:
        raise ValueError(f"Expected positive finite output scale, got {scale}")

    return max(1, round(width * scale)), max(1, round(height * scale))


def resize_rgb(rgb: np.ndarray, scale: float) -> np.ndarray:
    height, width = rgb.shape[:2]
    output_width, output_height = scaled_size(width, height, scale)
    if output_width == width and output_height == height:
        return rgb.copy()

    return cv2.resize(rgb, (output_width, output_height), interpolation=cv2.INTER_AREA).astype(np.float32)


def resize_position_finite_weighted(position_m: np.ndarray, scale: float) -> np.ndarray:
    if position_m.ndim != 3 or position_m.shape[2] != 3:
        raise ValueError(f"Expected HxWx3 position array, got {position_m.shape}")

    height, width = position_m.shape[:2]
    output_width, output_height = scaled_size(width, height, scale)
    if output_width == width and output_height == height:
        return position_m.copy()

    valid = np.isfinite(position_m).all(axis=2)
    weights = valid.astype(np.float32)
    weighted_position = np.where(valid[:, :, np.newaxis], position_m, 0.0).astype(np.float32)

    resized_weights = cv2.resize(weights, (output_width, output_height), interpolation=cv2.INTER_AREA)
    resized_weighted_position = cv2.resize(
        weighted_position,
        (output_width, output_height),
        interpolation=cv2.INTER_AREA,
    )

    resized_position = np.full((output_height, output_width, 3), np.nan, dtype=np.float32)
    np.divide(
        resized_weighted_position,
        resized_weights[:, :, np.newaxis],
        out=resized_position,
        where=resized_weights[:, :, np.newaxis] > 0.0,
    )
    return resized_position


def write_rgb_position_exr(path: Path, rgb: np.ndarray, position_m: np.ndarray) -> None:
    if rgb.ndim != 3 or rgb.shape[2] != 3:
        raise ValueError(f"Expected HxWx3 RGB array, got {rgb.shape}")
    if position_m.shape != (*rgb.shape[:2], 3):
        raise ValueError(f"Position shape {position_m.shape} does not match RGB shape {(*rgb.shape[:2], 3)}")

    pixels = np.concatenate([rgb, position_m], axis=2).astype(np.float32)
    height, width, channel_count = pixels.shape
    channel_names = ("R", "G", "B", *POSITION_CHANNEL_NAMES)

    spec = oiio.ImageSpec(width, height, channel_count, oiio.FLOAT)
    spec.channelnames = channel_names
    spec.attribute("compression", "zip")

    path.parent.mkdir(parents=True, exist_ok=True)
    output = oiio.ImageOutput.create(str(path))
    if output is None:
        raise RuntimeError(f"Failed to create OpenEXR output for {path}")

    try:
        if not output.open(str(path), spec):
            raise RuntimeError(f"Failed to open {path}: {output.geterror()}")
        if not output.write_image(pixels):
            raise RuntimeError(f"Failed to write {path}: {output.geterror()}")
    finally:
        output.close()


def verify_exr(path: Path, expected_shape: tuple[int, int]) -> None:
    image_input = oiio.ImageInput.open(str(path))
    if image_input is None:
        raise RuntimeError(f"Failed to open generated EXR: {path}")

    expected_height, expected_width = expected_shape
    try:
        spec = image_input.spec()
        if spec.width != expected_width or spec.height != expected_height:
            raise RuntimeError(
                f"Expected {expected_width}x{expected_height} EXR, got {spec.width}x{spec.height}"
            )

        channel_names = list(spec.channelnames)
        expected_channels = {"R", "G", "B", *POSITION_CHANNEL_NAMES}
        if set(channel_names) != expected_channels:
            raise RuntimeError(f"Expected channels {sorted(expected_channels)}, got {channel_names}")
        if "Z" in channel_names:
            raise RuntimeError("Generated position EXR must not include a standalone Z channel")

        pixels = image_input.read_image(format=oiio.FLOAT)
        if pixels is None:
            raise RuntimeError(f"Failed to read generated EXR pixels: {image_input.geterror()}")
    finally:
        image_input.close()

    pixels = np.asarray(pixels)
    channel_indices = {channel_name: index for index, channel_name in enumerate(channel_names)}
    rgb = np.stack([pixels[:, :, channel_indices[channel_name]] for channel_name in ("R", "G", "B")], axis=2)
    position = np.stack(
        [pixels[:, :, channel_indices[channel_name]] for channel_name in POSITION_CHANNEL_NAMES],
        axis=2,
    )

    if not np.isfinite(rgb).all():
        raise RuntimeError("RGB contains non-finite values")
    if float(rgb.min()) < 0.0 or float(rgb.max()) > 1.0:
        raise RuntimeError(f"RGB is outside [0, 1]: min={rgb.min()}, max={rgb.max()}")

    finite_components = np.isfinite(position)
    finite_triplets = finite_components.all(axis=2)
    partial_triplets = finite_components.any(axis=2) & ~finite_triplets
    if partial_triplets.any():
        raise RuntimeError("Position map contains partially finite XYZ triplets")

    valid_position = position[finite_triplets]
    if valid_position.size == 0:
        raise RuntimeError("Position map has no finite XYZ triplets")

    finite_z = valid_position[:, 2]
    if not (finite_z > 0.0).all():
        raise RuntimeError("P.Z channel contains non-positive finite values")

    invalid_count = int(finite_triplets.size - valid_position.shape[0])
    bounds_min = valid_position.min(axis=0)
    bounds_max = valid_position.max(axis=0)
    print(
        f"Verified {path}: {spec.width}x{spec.height}, channels={channel_names}, "
        f"X range={bounds_min[0]:.4f}..{bounds_max[0]:.4f} m, "
        f"Y range={bounds_min[1]:.4f}..{bounds_max[1]:.4f} m, "
        f"Z range={bounds_min[2]:.4f}..{bounds_max[2]:.4f} m, invalid={invalid_count}"
    )


def main() -> None:
    for filename, url in DOWNLOADS.items():
        download_if_missing(RAW_DIR / filename, url)

    rgb = read_rgb_png(RAW_DIR / "im0.png")
    disparity = read_pfm(RAW_DIR / "disp0.pfm")
    calibration = parse_calibration(RAW_DIR / "calib.txt")

    if disparity.shape != rgb.shape[:2]:
        raise RuntimeError(f"Disparity shape {disparity.shape} does not match RGB shape {rgb.shape[:2]}")

    depth_m = disparity_to_depth_m(disparity, calibration)
    position_m = depth_to_position_m(depth_m, calibration)
    output_rgb = resize_rgb(rgb, OUTPUT_SCALE)
    output_position_m = resize_position_finite_weighted(position_m, OUTPUT_SCALE)

    write_rgb_position_exr(OUTPUT_PATH, output_rgb, output_position_m)
    verify_exr(OUTPUT_PATH, output_rgb.shape[:2])


if __name__ == "__main__":
    main()
