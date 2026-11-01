# Third-party notices

This project optionally loads the following local ASR components. Model weights
are downloaded at runtime and are not redistributed with this repository.

## mlx-audio 0.6.3

- Project: https://github.com/Blaizzy/mlx-audio
- License: MIT
- Copyright (c) 2024 Prince Canuma

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## ASR model cards

| Component | Upstream | License |
| --- | --- | --- |
| Kotoba-Whisper v2.0 MLX | [kaiinui/kotoba-whisper-v2.0-mlx](https://huggingface.co/kaiinui/kotoba-whisper-v2.0-mlx), derived from [kotoba-tech/kotoba-whisper-v2.0](https://huggingface.co/kotoba-tech/kotoba-whisper-v2.0) | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) |
| Whisper Large v3 MLX | [mlx-community/whisper-large-v3-mlx](https://huggingface.co/mlx-community/whisper-large-v3-mlx), derived from [openai/whisper-large-v3](https://huggingface.co/openai/whisper-large-v3) | MLX conversion MIT; upstream Apache-2.0 |
| Whisper Large v3 Turbo (benchmark-only) | [mlx-community/whisper-large-v3-turbo](https://huggingface.co/mlx-community/whisper-large-v3-turbo), derived from [openai/whisper-large-v3-turbo](https://huggingface.co/openai/whisper-large-v3-turbo) | Upstream MIT; conversion card declares no additional license |
| Parakeet TDT-CTC 0.6B JA | [mlx-community/parakeet-tdt_ctc-0.6b-ja](https://huggingface.co/mlx-community/parakeet-tdt_ctc-0.6b-ja), derived from [nvidia/parakeet-tdt_ctc-0.6b-ja](https://huggingface.co/nvidia/parakeet-tdt_ctc-0.6b-ja) | [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) — credit NVIDIA and the MLX conversion contributors; indicate changes made by conversion/quantization |
| Qwen3-ASR 1.7B 8-bit | [mlx-community/Qwen3-ASR-1.7B-8bit](https://huggingface.co/mlx-community/Qwen3-ASR-1.7B-8bit), derived from [Qwen/Qwen3-ASR-1.7B](https://huggingface.co/Qwen/Qwen3-ASR-1.7B) | [Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0) |
