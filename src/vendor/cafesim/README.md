# Vendored from samcho93/cafesim (MIT, same author)

Copied so the M400 robot cafe runs inside the building (room 305, 3F) with its real
in-browser simulator. Keep changes minimal and marked `// webKopoCTCSim:`.

| here | upstream |
|---|---|
| core/ | packages/core/src (device simulation, protocols, Platform, Machine) |
| platforms/m400, m400-robot | platforms/ |
| viewer/scene/models.js, textures.js, cups.js | packages/viewer/src/scene |
| viewer/robot/RobotCell.js, collision.js, studyur/ | packages/viewer/src/robot (studyUR kinematics) |
| viewer/link.js | packages/viewer/src/link.js (LocalLink) |
| public/equipment/m400/ur | packages/viewer/public/ur (ur_description meshes, BSD-3) |

Local patches: the cafe group is translated into the building, so world <-> cafe-frame
conversions in RobotCell / collision use the cafe frame (search `webKopoCTCSim:`).
