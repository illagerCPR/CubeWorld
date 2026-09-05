// catalog.js -- 生产结构类型注册入口（terrain.js 侧效导入）
// 新增结构类型在此登记；测试用类型由 tests/ 自行注册，不进本文件。
// def.dims 声明维度作用域（缺省 = 任意维度）：村庄/要塞仅主世界，下界要塞仅下界，
// 末地城仅末地（外岛高原）。
import { registerStructureType } from './StructureManager.js';
import { VILLAGE_DEF } from './village.js';
import { STRONGHOLD_DEF } from './stronghold.js';
import { FORTRESS_DEF } from './fortress.js';
import { END_CITY_DEF } from './endCity.js';

VILLAGE_DEF.dims = ['overworld'];
STRONGHOLD_DEF.dims = ['overworld'];
registerStructureType('village', VILLAGE_DEF);
registerStructureType('stronghold', STRONGHOLD_DEF);
registerStructureType('fortress', FORTRESS_DEF);
registerStructureType('end_city', END_CITY_DEF);
