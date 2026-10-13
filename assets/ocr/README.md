# Local OCR models

Three official PaddleOCR float32 ONNX models read map text on the device. Their Apache-2.0 license is in `PADDLE-LICENSE`. ONNX Runtime's MIT license is in `ONNX-LICENSE`.

| File | Model | SHA-256 |
| --- | --- | --- |
| `pp-ocrv5-mobile-det.onnx` | PP-OCRv5_mobile_det | `a431985659dc921974177a95adcfbb90fd9e51989a5e04d70d0b75f597b6e61d` |
| `pp-ocrv5-latin-rec.onnx` | latin_PP-OCRv5_mobile_rec | `7888113072263cb471b93f66dd5e2ad70548dc526fa1ace760d0d973dd121498` |
| `pp-lcnet-textline-ori.onnx` | PP-LCNet_x0_25_textline_ori | `94a6a0a0425f2b5f08b5df72086f2d72abe40f1d22f6d12d2cd83674f11f2ff3` |
| `latin-dict.txt` | `character_dict` from the recognizer's `inference.yml`, one per line | `c3ab00106e4a4d151a8575b1129b91901a68a35b79a81fd63faab00418b87d75` |

Source archives (downloaded 2026-10-08 and 2026-10-13):
`https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/<model>_onnx_infer.tar`

The build verifies these hashes and copies the files and licenses to `public/ocr`, alongside the pinned npm ONNX Runtime WASM assets. Everything is precached in the offline app shell; no model downloads occur during imports or scans.

- **Detector.** Input: BGR, CHW float32, `/255`, mean `[0.485, 0.456, 0.406]`, std `[0.229, 0.224, 0.225]`, at the map's own resolution in 1024-pixel sections padded to 32-pixel multiples. Output: DB text probability map. Our decoder uses threshold 0.2, component score 0.6 and expansion ratio 1.5, fitting oriented rectangles without an OpenCV dependency.
- **Orientation.** Input: a straightened line squeezed to 160×80, BGR, ImageNet normalization. Output: probabilities for 0° and 180°.
- **Recognizer.** Input: a straightened line 48 pixels high, BGR, `/127.5 − 1`, followed by a 48-pixel blank. Output: CTC probabilities over blank, the 836 dictionary characters and a space.
