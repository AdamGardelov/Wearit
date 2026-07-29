#!/usr/bin/env python3

import argparse
import colorsys
from pathlib import Path

from PIL import Image, ImageFilter


GREEN_KEY = (20, 201, 18)
MAGENTA_KEY = (255, 0, 255)
ALPHA_NOISE_FLOOR = 8


def is_key_color(red: int, green: int, blue: int) -> bool:
    hue, saturation, value = colorsys.rgb_to_hsv(red / 255, green / 255, blue / 255)
    degrees = hue * 360
    vivid = saturation >= 0.18 and value >= 0.12
    return vivid and (65 <= degrees <= 175 or 280 <= degrees <= 350)


def clamp_channel(value: float) -> int:
    return max(0, min(255, int(round(value))))


def spill_channels(key: tuple[int, int, int]) -> list[int]:
    key_max = max(key)
    return [
        index
        for index, value in enumerate(key)
        if value >= key_max - 16 and value >= 128
    ]


def channel_distance(rgb: tuple[int, int, int], key: tuple[int, int, int]) -> int:
    return max(abs(rgb[index] - key[index]) for index in range(3))


def key_channel_dominance(rgb: tuple[int, int, int], key: tuple[int, int, int]) -> float:
    key_channels = spill_channels(key)
    non_key_channels = [index for index in range(3) if index not in key_channels]
    key_strength = min(rgb[index] for index in key_channels)
    non_key_strength = max((rgb[index] for index in non_key_channels), default=0)
    return float(key_strength - non_key_strength)


def looks_key_colored(rgb: tuple[int, int, int], key: tuple[int, int, int], distance: int) -> bool:
    return distance <= 32 or key_channel_dominance(rgb, key) >= 16


def smoothstep(value: float) -> float:
    value = max(0.0, min(1.0, value))
    return value * value * (3.0 - 2.0 * value)


def soft_alpha(distance: int) -> int:
    if distance <= 12:
        return 0
    if distance >= 220:
        return 255
    return clamp_channel(255 * smoothstep((distance - 12) / (220 - 12)))


def dominance_alpha(rgb: tuple[int, int, int], key: tuple[int, int, int]) -> int:
    dominance = key_channel_dominance(rgb, key)
    if dominance <= 0:
        return 255
    non_key_channels = [index for index in range(3) if index not in spill_channels(key)]
    non_key_strength = max((rgb[index] for index in non_key_channels), default=0)
    denominator = max(1, max(key) - non_key_strength)
    return clamp_channel(255 * (1 - min(1, dominance / denominator)))


def cleanup_spill(
    rgb: tuple[int, int, int],
    key: tuple[int, int, int],
    alpha: int,
) -> tuple[int, int, int]:
    if alpha >= 252:
        return rgb
    channels = [float(value) for value in rgb]
    key_channels = spill_channels(key)
    non_key_channels = [index for index in range(3) if index not in key_channels]
    anchor = max((channels[index] for index in non_key_channels), default=0)
    cap = max(0, anchor - 1)
    for index in key_channels:
        channels[index] = min(channels[index], cap)
    return tuple(clamp_channel(value) for value in channels)


def apply_soft_key(image: Image.Image, key: tuple[int, int, int]) -> Image.Image:
    cleaned = []
    for red, green, blue, alpha in image.getdata():
        rgb = (red, green, blue)
        distance = channel_distance(rgb, key)
        if looks_key_colored(rgb, key, distance):
            output_alpha = min(soft_alpha(distance), dominance_alpha(rgb, key))
            output_alpha = round(output_alpha * alpha / 255)
            if 0 < output_alpha <= ALPHA_NOISE_FLOOR:
                output_alpha = 0
            if output_alpha == 0:
                cleaned.append((0, 0, 0, 0))
                continue
            red, green, blue = cleanup_spill(rgb, key, output_alpha)
        else:
            output_alpha = alpha
        cleaned.append((red, green, blue, output_alpha))
    image.putdata(cleaned)
    alpha = image.getchannel("A").filter(ImageFilter.MinFilter(3)).filter(
        ImageFilter.GaussianBlur(0.25)
    )
    image.putalpha(alpha)
    return image


def remove_dual_chroma(source: Path, output: Path) -> tuple[int, int]:
    image = Image.open(source).convert("RGBA")
    width, height = image.size
    if width * height >= 100_000:
        image = apply_soft_key(image, GREEN_KEY)
        image = apply_soft_key(image, MAGENTA_KEY)
        pixels = list(image.getdata())
        removed = sum(pixel[3] == 0 for pixel in pixels)
        visible = sum(pixel[3] > 0 for pixel in pixels)
    else:
        pixels = []
        removed = 0
        visible = 0
        for red, green, blue, alpha in image.getdata():
            if alpha and is_key_color(red, green, blue):
                pixels.append((0, 0, 0, 0))
                removed += 1
            else:
                pixels.append((red, green, blue, alpha))
                visible += int(alpha > 0)
    if removed == 0 or visible == 0:
        raise ValueError(f"Invalid chroma result: removed={removed}, visible={visible}")
    minimum_run = max(3, width // 100)
    mask = [pixel[3] > 0 for pixel in pixels]
    dense_rows = []
    for y in range(height):
        kept_on_row = 0
        x = 0
        while x < width:
            if not mask[y * width + x]:
                x += 1
                continue
            start = x
            while x < width and mask[y * width + x]:
                x += 1
            length = x - start
            if length < minimum_run:
                for remove_x in range(start, x):
                    pixels[y * width + remove_x] = (0, 0, 0, 0)
                    mask[y * width + remove_x] = False
                    removed += 1
                    visible -= 1
            else:
                kept_on_row += length
        if kept_on_row >= minimum_run:
            dense_rows.append(y)

    if not dense_rows:
        raise ValueError("No garment-sized pixel runs remain after chroma cleanup")
    first_row, last_row = dense_rows[0], dense_rows[-1]
    for y in list(range(first_row)) + list(range(last_row + 1, height)):
        for x in range(width):
            index = y * width + x
            if pixels[index][3]:
                pixels[index] = (0, 0, 0, 0)
                removed += 1
                visible -= 1

    # Chroma renderers can leave a few neutral anti-aliased pixels far away
    # from the garment. Keep the main connected garment component and discard
    # only tiny isolated islands; intentional detached garment parts above the
    # threshold remain intact.
    mask = bytearray(pixel[3] > 0 for pixel in pixels)
    visited = bytearray(width * height)
    minimum_component = max(2, (width * height) // 10000)
    for start, present in enumerate(mask):
        if not present or visited[start]:
            continue
        component = []
        stack = [start]
        visited[start] = 1
        while stack:
            index = stack.pop()
            component.append(index)
            y, x = divmod(index, width)
            neighbours = []
            if x:
                neighbours.append(index - 1)
            if x + 1 < width:
                neighbours.append(index + 1)
            if y:
                neighbours.append(index - width)
            if y + 1 < height:
                neighbours.append(index + width)
            for neighbour in neighbours:
                if mask[neighbour] and not visited[neighbour]:
                    visited[neighbour] = 1
                    stack.append(neighbour)
        if len(component) <= minimum_component:
            for index in component:
                pixels[index] = (0, 0, 0, 0)
                removed += 1
                visible -= 1

    # Fill only transparent chroma holes completely enclosed by garment. The
    # outer background and openings connected to it (for example between pant
    # legs) stay transparent. Propagate neighbouring garment colour inward so
    # the filled pixels do not become black specks.
    exterior = bytearray(width * height)
    stack = []
    for x in range(width):
        for y in (0, height - 1):
            index = y * width + x
            if pixels[index][3] == 0 and not exterior[index]:
                exterior[index] = 1
                stack.append(index)
    for y in range(height):
        for x in (0, width - 1):
            index = y * width + x
            if pixels[index][3] == 0 and not exterior[index]:
                exterior[index] = 1
                stack.append(index)
    while stack:
        index = stack.pop()
        y, x = divmod(index, width)
        neighbours = []
        if x:
            neighbours.append(index - 1)
        if x + 1 < width:
            neighbours.append(index + 1)
        if y:
            neighbours.append(index - width)
        if y + 1 < height:
            neighbours.append(index + width)
        for neighbour in neighbours:
            if pixels[neighbour][3] == 0 and not exterior[neighbour]:
                exterior[neighbour] = 1
                stack.append(neighbour)
    pending = {
        index
        for index, pixel in enumerate(pixels)
        if pixel[3] == 0 and not exterior[index]
    }
    while pending:
        filled = []
        for index in pending:
            y, x = divmod(index, width)
            neighbours = []
            if x:
                neighbours.append(index - 1)
            if x + 1 < width:
                neighbours.append(index + 1)
            if y:
                neighbours.append(index - width)
            if y + 1 < height:
                neighbours.append(index + width)
            colours = [pixels[n][:3] for n in neighbours if pixels[n][3] > 0]
            if colours:
                pixels[index] = tuple(
                    round(sum(colour[channel] for colour in colours) / len(colours))
                    for channel in range(3)
                ) + (255,)
                filled.append(index)
        if not filled:
            break
        for index in filled:
            pending.remove(index)
            removed -= 1
            visible += 1

    image.putdata(pixels)
    output.parent.mkdir(parents=True, exist_ok=True)
    image.save(output, format="PNG")
    return removed, visible


def main() -> None:
    parser = argparse.ArgumentParser(description="Remove Wearit green background and magenta mannequin chroma.")
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    removed, visible = remove_dual_chroma(args.input, args.out)
    print(f"Wrote {args.out}")
    print(f"Removed pixels: {removed}")
    print(f"Visible pixels: {visible}")


if __name__ == "__main__":
    main()
