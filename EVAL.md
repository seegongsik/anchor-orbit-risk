# EVAL

Real scenes only. Each row is one photo taken with the app ("Save capture for evaluation" writes the JPG and a JSON with the gravity vector and the marks). The ruler value is measured by hand on site: the horizontal distance from the object's centre of mass to the edge (for a uniform box, from its middle). Nothing in this table is invented; an empty cell means not measured yet.

| # | Scene | Object | Mask (SAM 3.1 / hand) | Phone tilt (°) | d app (cm) | ± (cm) | d ruler (cm) | Error (cm) | Draws past the line | Notes |
| - | ----- | ------ | --------------------- | -------------- | ---------- | ------ | ------------ | ---------- | ------------------- | ----- |

Summary to fill in after the rows: mean absolute error, the largest errors and why (view not end-on, scale not at the object's depth, mask, density).

## Tilt check

Each row is one run of the tilt check: a side photo of the object standing on a level board, then the board raised slowly with the phone lying on it ("Download tilt results" writes the JSON). The prediction assumes uniform density and no sliding. A rubber mat under the object, something unbreakable, a soft landing. Nothing here is invented; an empty cell means not measured yet.

| # | Object | Mask (SAM 3.1 / hand) | Side | Predicted (°) | 5–95% (°) | Measured (°) | Difference (°) | Detected by (jolt / button) | Notes |
| - | ------ | --------------------- | ---- | ------------- | --------- | ------------ | -------------- | --------------------------- | ----- |

Summary to fill in after the rows: mean absolute difference, how often the measured angle fell inside the 5–95% range, and the largest differences and why (uneven density, slipping, a soft base, the board raised too fast).
