# Destination models

Drop GLB/GLTF files here to replace the procedural placeholders:

| Destination  | Expected file        |
| ------------ | -------------------- |
| Colombo      | `colombo.glb`        |
| Kandy        | `kandy.glb`          |
| Jaffna       | `jaffna.glb`         |
| Nuwara Eliya | `nuwara-eliya.glb`   |
| Galle        | `galle.glb`          |

Author models with +Y up, the base at y = 0 and 1 unit ≈ 1 km of footprint
(about 6–8 units across reads well). Draco-compressed GLBs are supported.
Fine-tune `model.scale`, `model.rotationY` and `model.offset` in
`src/data/destinations.js`. Missing files fall back to the placeholders.
