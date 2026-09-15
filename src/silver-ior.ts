// Mitsuba 3 ior_from_file("Ag"): spectrum_list_to_srgb(..., false, false).
// 1000 samples over 360..830 nm, linearly interpolated 5 nm CIE 1931 curves,
// MI_CIE_Y_NORMALIZATION, and Mitsuba's XYZ-to-linear-sRGB matrix.
// Data: https://github.com/mitsuba-renderer/mitsuba-data/tree/master/ior
// Reproduce with: node scripts/generate-silver-ior.mjs
export const MITSUBA_SILVER_ETA = [0.15527619421482086, 0.11672795563936234, 0.13838763535022736] as const;
export const MITSUBA_SILVER_K = [4.828354358673096, 3.122222423553467, 2.1469011306762695] as const;
