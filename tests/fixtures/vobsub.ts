// A DVD subtitle track's .idx header, and one subpicture unit of it: 4×2 at (10, 20); line 0 (top
// field) two pixels of value 1, then value 2 to the end; line 1 (bottom field) four pixels of value 3.
// Shown at once, gone after 88 ticks of 1024/90000 s.
export const VOBSUB_IDX = 'size: 720x576\norg: 0, 0\npalette: 000000, f0f0f0, cccccc, 999999, 3333fa\n'

export const SPU = new Uint8Array([
  0, 38, 0, 8, // size, first control sequence
  0x90, 0x00, 0x20, // top field: run (2, 1); fill with 2; byte align
  0x13, // bottom field: run (4, 3)
  0, 0, 0, 32, // at 0; next sequence
  0x01, // show
  0x03, 0x32, 0x10, // pixel values 3 2 1 0 take palette colours 3 2 1 0
  0x04, 0xff, 0xf0, // opaque, value 0 transparent
  0x05, 0x00, 0xa0, 0x0d, 0x01, 0x40, 0x15, // x 10–13, y 20–21
  0x06, 0, 4, 0, 7, // where the fields start
  0xff,
  0, 88, 0, 32, // at 88 ticks; last sequence
  0x02, // hide
  0xff,
])
