#!/usr/bin/env python3
"""Generate Kotlin token definitions from tokens.json (W3C DTCG).

Usage: python3 generate.py [tokens.json] [output.kt]
Defaults: tokens.json in the same dir, output to
../android/theme/src/main/java/com/astryx/kitchensink/theme/GeneratedTokens.kt

Resolves {dotted.path} aliases, then emits Compose-ready `val`s.
Re-run after any token edit and commit the result.
"""
import json
import re
import sys
from pathlib import Path

ALIAS_RE = re.compile(r"^\{(.+)\}$")


def flatten(node, prefix=()):
    """Yield (path_tuple, token_dict) for every DTCG token (dict with $value)."""
    if isinstance(node, dict) and "$value" in node:
        yield prefix, node
        return
    if isinstance(node, dict):
        for key, child in node.items():
            if key.startswith("$"):
                continue
            yield from flatten(child, prefix + (key,))


def resolve(value, table, stack=()):
    m = ALIAS_RE.match(value.strip()) if isinstance(value, str) else None
    if not m:
        return value
    path = tuple(m.group(1).split("."))
    if path in stack:
        raise ValueError(f"Circular alias: {' -> '.join(stack + (path,))}")
    if path not in table:
        raise ValueError(f"Unresolved alias {{{m.group(1)}}}")
    return resolve(table[path], table, stack + (path,))


def kotlin_name(path):
    parts = []
    for p in path:
        p = re.sub(r"[^0-9a-zA-Z]+", " ", p).title().replace(" ", "")
        parts.append(p)
    name = "".join(parts)
    return name[0].upper() + name[1:]


def main():
    here = Path(__file__).resolve().parent
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else here / "tokens.json"
    default_out = (
        here / "../android/theme/src/main/java/com/astryx/kitchensink/theme/GeneratedTokens.kt"
    )
    out = Path(sys.argv[2]) if len(sys.argv) > 2 else default_out

    data = json.loads(src.read_text())
    raw = {path: tok["$value"] for path, tok in flatten(data)}
    resolved = {path: resolve(v, raw) for path, v in raw.items()}

    colors, dims = [], []
    for path in sorted(resolved, key=kotlin_name):
        name = kotlin_name(path)
        value = resolved[path]
        if re.fullmatch(r"#[0-9a-fA-F]{6}", value or ""):
            argb = "0xFF" + value[1:].upper()
            colors.append(f"val {name} = Color({argb})")
        elif re.fullmatch(r"-?\d+(\.\d+)?", value or ""):
            dims.append(f"val {name} = {value}.dp")
        # percentage / other types are handled manually in the theme module

    header = """// GENERATED — do not edit by hand. Source: design-tokens/tokens.json
// Regenerate: python3 design-tokens/generate.py
package com.astryx.kitchensink.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

"""
    body = "// Primitive + semantic colors\n" + "\n".join(colors)
    body += "\n\n// Spacing / radius / elevation (dp)\n" + "\n".join(dims) + "\n"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(header + body)
    print(f"Wrote {out} ({len(colors)} colors, {len(dims)} dimensions)")


if __name__ == "__main__":
    main()
