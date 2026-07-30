import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image


SCRIPT = (
    Path(__file__).parents[2]
    / "scripts"
    / "wearit-images"
    / "remove-dual-chroma.py"
)


class RemoveDualChromaTest(unittest.TestCase):
    @staticmethod
    def make_small_source(source: Path) -> None:
        image = Image.new("RGBA", (5, 1))
        image.putdata([
            (20, 201, 18, 255),
            (251, 4, 232, 255),
            (32, 18, 14, 255),
            (248, 244, 232, 255),
            (5, 5, 5, 255),
        ])
        image.save(source)

    def test_removes_green_and_magenta_without_erasing_brown_white_or_black(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.png"
            output = Path(directory) / "output.png"
            image = Image.new("RGBA", (5, 1))
            image.putdata([
                (20, 201, 18, 255),
                (251, 4, 232, 255),
                (32, 18, 14, 255),
                (248, 244, 232, 255),
                (5, 5, 5, 255),
            ])
            image.save(source)

            result = subprocess.run(
                [sys.executable, str(SCRIPT), "--input", str(source), "--out", str(output)],
                capture_output=True,
                text=True,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            pixels = list(Image.open(output).convert("RGBA").getdata())
            self.assertEqual([pixel[3] for pixel in pixels], [0, 0, 255, 255, 255])

    def test_removes_thin_neutral_chroma_outlines_but_keeps_garment_runs(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.png"
            output = Path(directory) / "output.png"
            image = Image.new("RGBA", (12, 3), (20, 201, 18, 255))
            pixels = image.load()
            pixels[1, 0] = (90, 90, 70, 255)
            for x in range(2, 10):
                pixels[x, 1] = (32, 18, 14, 255)
            pixels[10, 2] = (80, 80, 65, 255)
            image.save(source)

            result = subprocess.run(
                [sys.executable, str(SCRIPT), "--input", str(source), "--out", str(output)],
                capture_output=True,
                text=True,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            cleaned = Image.open(output).convert("RGBA")
            self.assertEqual(cleaned.getpixel((1, 0))[3], 0)
            self.assertTrue(all(cleaned.getpixel((x, 1))[3] == 255 for x in range(2, 10)))
            self.assertEqual(cleaned.getpixel((10, 2))[3], 0)

    def test_soft_keys_dark_magenta_fringe_attached_to_garment(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.png"
            output = Path(directory) / "output.png"
            image = Image.new("RGBA", (400, 400), (20, 201, 18, 255))
            pixels = image.load()
            for y in range(100, 300):
                for x in range(100, 300):
                    pixels[x, y] = (32, 18, 14, 255)
            # Simulate the blocky two-pixel dark fringe left by the generated
            # chroma render along alternating sections of a trouser edge.
            for y in range(120, 140):
                pixels[98, y] = (28, 12, 40, 255)
                pixels[99, y] = (28, 12, 40, 255)
            image.save(source)

            result = subprocess.run(
                [sys.executable, str(SCRIPT), "--input", str(source), "--out", str(output)],
                capture_output=True,
                text=True,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            cleaned = Image.open(output).convert("RGBA")
            self.assertLessEqual(cleaned.getpixel((99, 130))[3], 8)
            self.assertGreaterEqual(cleaned.getpixel((102, 130))[3], 240)

    def test_removes_small_isolated_neutral_island(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.png"
            output = Path(directory) / "output.png"
            image = Image.new("RGBA", (300, 300), (20, 201, 18, 255))
            pixels = image.load()
            for y in range(40, 60):
                for x in range(35, 65):
                    pixels[x, y] = (32, 18, 14, 255)
            for x in range(45, 54):
                pixels[x, 5] = (90, 90, 70, 255)
            image.save(source)

            result = subprocess.run(
                [sys.executable, str(SCRIPT), "--input", str(source), "--out", str(output)],
                capture_output=True,
                text=True,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            cleaned = Image.open(output).convert("RGBA")
            self.assertEqual(cleaned.getpixel((49, 5))[3], 0)
            self.assertEqual(cleaned.getpixel((49, 49))[3], 255)

    def test_antialiases_edges_on_production_sized_images(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.png"
            output = Path(directory) / "output.png"
            image = Image.new("RGBA", (400, 400), (20, 201, 18, 255))
            pixels = image.load()
            for y in range(100, 300):
                for x in range(100, 300):
                    pixels[x, y] = (32, 18, 14, 255)
            image.save(source)

            result = subprocess.run(
                [sys.executable, str(SCRIPT), "--input", str(source), "--out", str(output)],
                capture_output=True,
                text=True,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            alphas = [alpha for *_, alpha in Image.open(output).convert("RGBA").getdata()]
            self.assertIn(0, alphas)
            self.assertIn(255, alphas)
            self.assertTrue(any(0 < alpha < 255 for alpha in alphas))

    def test_contracts_two_pixel_dark_chroma_fringe_on_production_images(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.png"
            output = Path(directory) / "output.png"
            image = Image.new("RGBA", (400, 400), (20, 201, 18, 255))
            pixels = image.load()
            for y in range(100, 300):
                for x in range(100, 300):
                    pixels[x, y] = (32, 18, 14, 255)
            for y in range(120, 140):
                pixels[98, y] = (28, 25, 20, 255)
                pixels[99, y] = (30, 24, 18, 255)
            image.save(source)

            result = subprocess.run(
                [sys.executable, str(SCRIPT), "--input", str(source), "--out", str(output)],
                capture_output=True,
                text=True,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            cleaned = Image.open(output).convert("RGBA")
            fringe_alpha = cleaned.getpixel((99, 130))[3]
            smooth_edge_alpha = cleaned.getpixel((99, 160))[3]
            self.assertLessEqual(abs(fringe_alpha - smooth_edge_alpha), 50)
            self.assertGreaterEqual(cleaned.getpixel((102, 130))[3], 240)

    def test_fills_enclosed_chroma_hole_but_keeps_exterior_transparent(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.png"
            output = Path(directory) / "output.png"
            image = Image.new("RGBA", (20, 20), (20, 201, 18, 255))
            pixels = image.load()
            for y in range(4, 16):
                for x in range(4, 16):
                    pixels[x, y] = (70, 40, 30, 255)
            for y in range(8, 11):
                for x in range(8, 11):
                    pixels[x, y] = (251, 4, 232, 255)
            image.save(source)

            result = subprocess.run(
                [sys.executable, str(SCRIPT), "--input", str(source), "--out", str(output)],
                capture_output=True,
                text=True,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            cleaned = Image.open(output).convert("RGBA")
            self.assertEqual(cleaned.getpixel((9, 9))[3], 255)
            self.assertEqual(cleaned.getpixel((0, 0))[3], 0)

    def test_rejects_same_path_and_symlink_alias_outputs(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.png"
            alias = Path(directory) / "source-alias.png"
            self.make_small_source(source)
            alias.symlink_to(source)
            source_before = source.read_bytes()

            same_path = subprocess.run(
                [sys.executable, str(SCRIPT), "--input", str(source), "--out", str(source)],
                capture_output=True,
                text=True,
            )
            symlink_alias = subprocess.run(
                [sys.executable, str(SCRIPT), "--input", str(source), "--out", str(alias)],
                capture_output=True,
                text=True,
            )

            self.assertNotEqual(same_path.returncode, 0)
            self.assertRegex(same_path.stderr, r"(?i)output.*input|same path|alias")
            self.assertNotEqual(symlink_alias.returncode, 0)
            self.assertRegex(symlink_alias.stderr, r"(?i)output.*input|same path|alias")
            self.assertEqual(source.read_bytes(), source_before)

    def test_rejects_existing_output_without_overwriting_it(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.png"
            output = Path(directory) / "output.png"
            self.make_small_source(source)
            sentinel = b"existing output"
            output.write_bytes(sentinel)

            result = subprocess.run(
                [sys.executable, str(SCRIPT), "--input", str(source), "--out", str(output)],
                capture_output=True,
                text=True,
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertRegex(result.stderr, r"(?i)output.*exists")
            self.assertEqual(output.read_bytes(), sentinel)

    def test_cleans_sibling_temporary_when_chroma_removal_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "source.png"
            output = Path(directory) / "output.png"
            Image.new("RGBA", (5, 1), (32, 18, 14, 255)).save(source)

            result = subprocess.run(
                [sys.executable, str(SCRIPT), "--input", str(source), "--out", str(output)],
                capture_output=True,
                text=True,
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(output.exists())
            self.assertEqual(list(Path(directory).glob(".output.png.*.tmp")), [])


if __name__ == "__main__":
    unittest.main()
