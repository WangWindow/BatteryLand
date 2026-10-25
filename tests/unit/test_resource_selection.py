from batteryland.scheduler.resources import choose_device


def test_auto_chooses_available_cuda_device_and_explicit_never_remaps():
    snapshot = {
        "gpus": [
            {"cuda_index": 0, "uuid": "GPU-0", "free_bytes": 0},
            {"cuda_index": 1, "uuid": "GPU-1", "free_bytes": 900},
        ]
    }
    assert choose_device("auto", snapshot) == "cuda:1"
    assert choose_device("cuda:1", snapshot) == "cuda:1"
    assert choose_device("cuda:0", snapshot) is None
    assert choose_device("cpu", snapshot) is None
