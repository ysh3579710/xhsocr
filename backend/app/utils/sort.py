import re


_NS_REGEX = re.compile(r"(\d+)")


def natural_sort_key(value: str):
    parts = _NS_REGEX.split(value)
    return [int(p) if p.isdigit() else p.lower() for p in parts]
