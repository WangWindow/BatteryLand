import pytest

from batteryland.common.errors import DomainError
from batteryland.experiments.validated import parse_inputs

CONFIG = "mate:\n  device: auto\n"


@pytest.mark.parametrize(
    "split",
    [
        '{"dataset":"demo","train":["a.pkl"],"val":[],"test":[],"other":[]}',
        '{"dataset":"demo","train":["../a.pkl"],"val":[],"test":[]}',
        '{"dataset":"demo","train":["a.pkl"],"val":["a.pkl"],"test":[]}',
        '{"dataset":"demo","train":["a.pkl","a.pkl"],"val":[],"test":[]}',
        '{"dataset":"demo","train":["a.pkl"],"train":[],"val":[],"test":[]}',
    ],
)
def test_split_input_rejects_unsafe_or_ambiguous_members(split: str):
    with pytest.raises(DomainError) as error:
        parse_inputs(CONFIG, split)

    assert error.value.symbol == "invalid_input"
