# Local OCR models

These are official PaddleOCR float32 ONNX exports: `PP-OCRv5_mobile_det`, `latin_PP-OCRv5_mobile_rec` and `PP-LCNet_x0_25_textline_ori`. They were downloaded on 2026-10-08 and 2026-10-13 from:

`https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/<model>_onnx_infer.tar`

`latin-dict.txt` is the recognizer's `character_dict` from its `inference.yml`, one character per line. Preprocessing constants come from each model's `inference.yml`. `scripts/ocr-assets.ts` checks the hashes and copies these files to `public/ocr`; update the hashes there when a model changes.
