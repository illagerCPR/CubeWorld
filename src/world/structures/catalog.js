// catalog.js -- 生产结构类型注册入口（terrain.js 侧效导入）
// 新增结构类型在此登记；测试用类型由 tests/ 自行注册，不进本文件。
import { registerStructureType } from './StructureManager.js';
import { VILLAGE_DEF } from './village.js';

registerStructureType('village', VILLAGE_DEF);
