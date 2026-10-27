"""VisualGuard: checks an image against a brand's approved logos and colour palette.

Everything here is classical image processing (colour distance in Lab space, template matching on edge maps), so it is
deterministic, free to run, and every finding points at a rectangle of the image that anyone can look at."""
