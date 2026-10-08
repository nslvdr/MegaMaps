# Local text-region detector

`pp-ocrv5-mobile-det.onnx` is the official PaddleOCR **PP-OCRv5_mobile_det** float32 ONNX model. Its Apache-2.0 license is in `PADDLE-LICENSE`. ONNX Runtime's MIT license is in `ONNX-LICENSE`.

Source archive (downloaded 2026-10-08):
https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/PP-OCRv5_mobile_det_onnx_infer.tar

Upstream model inventory and preprocessing reference:
https://github.com/PaddlePaddle/PaddleOCR/tree/main/paddleocr-js/packages/core/src/models
https://github.com/PaddlePaddle/PaddleOCR/blob/main/paddleocr-js/packages/core/src/resources/model-asset.ts

Model SHA-256: `a431985659dc921974177a95adcfbb90fd9e51989a5e04d70d0b75f597b6e61d`

The build verifies this hash and copies the model and licenses to `public/ocr`, alongside the pinned npm ONNX Runtime WASM assets. Everything is precached in the offline app shell; no model downloads occur during imports or scans.

Input: BGR, CHW float32, RGB-source channels reversed, `/255`, mean `[0.485, 0.456, 0.406]`, std `[0.229, 0.224, 0.225]`; dimensions rounded to 32-pixel multiples with long side capped at 960. Output: DB text probability map. Our decoder uses threshold 0.3, component score 0.6, and expansion ratio 1.5. It fits oriented rectangles to component boundaries without adding an OpenCV dependency.
