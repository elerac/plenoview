void main() {
  DisplaySample displaySample = readDisplaySample(ivec2(gl_FragCoord.xy));
  // Invalid Stokes components must not poison neighboring mip texels. Keep HDR
  // values linear: exposure, display gamma, palettes, and warnings happen later.
  outColor = vec4(sanitizeDisplayColor(displaySample.linear), displaySample.alpha);
}
