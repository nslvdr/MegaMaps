#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <setjmp.h>
#include <emscripten.h>
#include <jpeglib.h>

/* A synchronous OPFS source keeps even the compressed original out of WASM RAM. */
EM_JS(int, input_read, (unsigned char *dst, int offset, int count), {
  try { return Module.readInput(offset, HEAPU8.subarray(dst, dst + count)); }
  catch (e) { Module.ioError = String(e); return -1; }
});
struct error_state { struct jpeg_error_mgr base; jmp_buf jump; char message[JMSG_LENGTH_MAX]; };
struct source_state { struct jpeg_source_mgr base; unsigned char buffer[65536]; int offset; };
static struct jpeg_decompress_struct image;
static struct error_state error;
static struct source_state source;
static unsigned char *row;
static int created;
static int cmyk;
static void fail(j_common_ptr c) { (*c->err->format_message)(c, error.message); longjmp(error.jump, 1); }
static void init_source(j_decompress_ptr c) { source.offset = 0; }
static boolean fill(j_decompress_ptr c) {
  int n = input_read(source.buffer, source.offset, sizeof(source.buffer));
  if (n <= 0) { strcpy(error.message, "JPEG data is truncated or unreadable."); longjmp(error.jump, 1); }
  source.offset += n;
  source.base.next_input_byte = source.buffer;
  source.base.bytes_in_buffer = n;
  return TRUE;
}
static void skip(j_decompress_ptr c, long n) {
  if (n <= 0) return;
  while ((size_t)n > source.base.bytes_in_buffer) { n -= source.base.bytes_in_buffer; fill(c); }
  source.base.next_input_byte += n; source.base.bytes_in_buffer -= n;
}
static void term_source(j_decompress_ptr c) {}
EMSCRIPTEN_KEEPALIVE void decoder_close(void) {
  free(row); row = NULL;
  if (created) { jpeg_destroy_decompress(&image); created = 0; }
}
/* Callers set the error jump first. */
static int open_source(void) {
  memset(&image, 0, sizeof(image));
  image.err = jpeg_std_error(&error.base); error.base.error_exit = fail;
  jpeg_create_decompress(&image); created = 1;
  memset(&source, 0, sizeof(source));
  source.base.init_source = init_source; source.base.fill_input_buffer = fill;
  source.base.skip_input_data = skip; source.base.resync_to_restart = jpeg_resync_to_restart; source.base.term_source = term_source;
  image.src = &source.base;
  jpeg_read_header(&image, TRUE);
  if (image.image_width * (double)image.image_height > 300000000 || image.data_precision != 8) { strcpy(error.message, "JPEG exceeds supported dimensions/precision."); decoder_close(); return 0; }
  image.mem->max_memory_to_use = 12 * 1024 * 1024;
  return 1;
}
EMSCRIPTEN_KEEPALIVE int decoder_open(void) {
  if (setjmp(error.jump)) { decoder_close(); return 0; }
  if (!open_source()) return 0;
  cmyk = image.jpeg_color_space == JCS_CMYK || image.jpeg_color_space == JCS_YCCK;
  image.out_color_space = cmyk ? JCS_CMYK : JCS_EXT_RGBA;
  jpeg_start_decompress(&image);
  row = malloc(image.output_width * 4);
  if (!row) { strcpy(error.message, "Not enough decoder memory."); decoder_close(); return 0; }
  return image.output_width;
}
EMSCRIPTEN_KEEPALIVE int decoder_height(void) { return image.output_height; }
EMSCRIPTEN_KEEPALIVE unsigned char *decoder_row(void) {
  if (setjmp(error.jump)) return NULL;
  if (!created || image.output_scanline >= image.output_height) return NULL;
  JSAMPROW rows[1] = { row };
  if (jpeg_read_scanlines(&image, rows, 1) != 1) return NULL;
  if (cmyk) {
    /* Adobe JPEG stores inverted CMYK; other CMYK uses conventional ink values. */
    for (unsigned int x = 0; x < image.output_width; x++) {
      unsigned char *p = row + x * 4;
      int k = image.saw_Adobe_marker ? p[3] : 255 - p[3];
      for (int i = 0; i < 3; i++) p[i] = ((image.saw_Adobe_marker ? p[i] : 255 - p[i]) * k + 127) / 255;
      p[3] = 255;
    }
  }
  return row;
}
EMSCRIPTEN_KEEPALIVE int decoder_finish(void) {
  if (setjmp(error.jump)) return 0;
  return jpeg_finish_decompress(&image) ? 1 : 0;
}
EMSCRIPTEN_KEEPALIVE char *decoder_error(void) { return error.message; }

/* Level-0 tiles are crops of the original's DCT blocks, so no pixel is
   re-encoded. A tile edge must fall on an iMCU edge, and the whole-image
   coefficients spill to OPFS like progressive decoding does. */
#define TILE 512
#define BATCH_BYTES (24 * 1024 * 1024)
#define BATCH_MAX 48
EM_JS(void, tile_output, (int x, int y, unsigned char *data, int size), {
  Module.writeTile(x, y, HEAPU8.slice(data, data + size));
});
static jvirt_barray_ptr *coefs;
/* DCT blocks covering a span, padded to whole MCUs like libjpeg's own arrays. */
static long blocks(long pixels, int samp, int max) {
  long n = ((pixels * samp + max - 1) / max + DCTSIZE - 1) / DCTSIZE;
  return (n + samp - 1) / samp * samp;
}
static struct jpeg_compress_struct crops[BATCH_MAX];
static jvirt_barray_ptr crop_coefs[BATCH_MAX][MAX_COMPONENTS];
EMSCRIPTEN_KEEPALIVE int cropper_open(void) {
  if (setjmp(error.jump)) { decoder_close(); return 0; }
  if (!open_source()) return 0;
  J_COLOR_SPACE space = image.jpeg_color_space;
  if ((space != JCS_GRAYSCALE && space != JCS_YCbCr && space != JCS_RGB) ||
      TILE % (image.max_h_samp_factor * DCTSIZE) || TILE % (image.max_v_samp_factor * DCTSIZE)) {
    strcpy(error.message, "JPEG cannot be cut into lossless tiles."); decoder_close(); return 0;
  }
  coefs = jpeg_read_coefficients(&image);
  return image.image_width;
}
/* Emits one row of tiles. Source block rows are read once per batch of tiles.
   After an error the module is discarded, so partial batches are not freed. */
EMSCRIPTEN_KEEPALIVE int cropper_row(int ty) {
  if (setjmp(error.jump)) return 0;
  int maxh = image.max_h_samp_factor, maxv = image.max_v_samp_factor, tile_bytes = 0;
  for (int ci = 0; ci < image.num_components; ci++)
    tile_bytes += (TILE / DCTSIZE) * image.comp_info[ci].h_samp_factor / maxh *
      (TILE / DCTSIZE) * image.comp_info[ci].v_samp_factor / maxv * (int)sizeof(JBLOCK);
  int cols = (image.image_width + TILE - 1) / TILE, batch = BATCH_BYTES / tile_bytes;
  if (batch > BATCH_MAX) batch = BATCH_MAX;
  if (batch < 1) batch = 1;
  for (int x0 = 0; x0 < cols; x0 += batch) {
    int n = cols - x0 < batch ? cols - x0 : batch;
    for (int i = 0; i < n; i++) {
      j_compress_ptr crop = &crops[i];
      memset(crop, 0, sizeof(*crop));
      crop->err = &error.base;
      jpeg_create_compress(crop);
      jpeg_copy_critical_parameters(&image, crop);
      crop->image_width = image.image_width - (x0 + i) * TILE < TILE ? image.image_width - (x0 + i) * TILE : TILE;
      crop->image_height = image.image_height - ty * TILE < TILE ? image.image_height - ty * TILE : TILE;
      for (int ci = 0; ci < crop->num_components; ci++) {
        jpeg_component_info *c = &crop->comp_info[ci];
        crop_coefs[i][ci] = (*crop->mem->request_virt_barray)((j_common_ptr)crop, JPOOL_IMAGE, FALSE,
          blocks(crop->image_width, c->h_samp_factor, maxh), blocks(crop->image_height, c->v_samp_factor, maxv), c->v_samp_factor);
      }
      (*crop->mem->realize_virt_arrays)((j_common_ptr)crop);
    }
    for (int ci = 0; ci < image.num_components; ci++) {
      jpeg_component_info *c = &image.comp_info[ci];
      int across = TILE / DCTSIZE * c->h_samp_factor / maxh, down = TILE / DCTSIZE * c->v_samp_factor / maxv;
      long rows = blocks(crops[0].image_height, c->v_samp_factor, maxv);
      for (long r = 0; r < rows; r++) {
        JBLOCKARRAY from = (*image.mem->access_virt_barray)((j_common_ptr)&image, coefs[ci], ty * down + r, 1, FALSE);
        for (int i = 0; i < n; i++) {
          long w = blocks(crops[i].image_width, c->h_samp_factor, maxh);
          JBLOCKARRAY to = (*crops[i].mem->access_virt_barray)((j_common_ptr)&crops[i], crop_coefs[i][ci], r, 1, TRUE);
          memcpy(to[0], from[0] + (x0 + i) * across, w * sizeof(JBLOCK));
        }
      }
    }
    for (int i = 0; i < n; i++) {
      unsigned char *out = NULL;
      unsigned long size = 0;
      crops[i].optimize_coding = TRUE;
      jpeg_mem_dest(&crops[i], &out, &size);
      jpeg_write_coefficients(&crops[i], crop_coefs[i]);
      jpeg_finish_compress(&crops[i]);
      tile_output(x0 + i, ty, out, size);
      free(out);
      jpeg_destroy_compress(&crops[i]);
    }
  }
  return 1;
}
