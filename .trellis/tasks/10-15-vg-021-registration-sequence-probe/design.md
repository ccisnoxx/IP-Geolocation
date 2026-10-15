# 设计与停止条件

复用docs/stabilization/alternative-injection-rfc.md方案F及P0-F；当前长期架构合同不改。新的脚本只在系统临时目录生成十余个小型固定程序，只有合成位和语言getter；它不读取VanishGeo storage/resolver、不导入runtime、不连接provider/STUN。

先测试4位与最多32位的同文件重复、共享global和lexical组装，微任务仅记录发生位置。页面首脚本只读实际值，预期保留在驱动。攻击页由普通同源父页在初始blank上预置setter/Array方法等，不使用CDP提前注入冒充普通页面能力。公开组装对照验证攻击有效；任何未经授权的位改变安装getter即拒绝该设计。只测试最小机制，不为失败扩建片段库、引入签名或新权限。

配置新鲜度在独立测试扩展中模拟：storage保存禁用与注册API完成分别观测；不得宣称跨API原子性。更新、注销完成及在途文档分别记录。发现阻断后只完成解释该阻断所需对照，不扩展P1/P2/P3/P4或生产实施。失败不意味着所有F变体不可能；有限通过不证明完整payload、所有Chrome或原生最终文档绑定。

临时profile、extension、server由finally清理；证据只保存合成位、布尔/分类和版本/相对路径/摘要，不保存原生语言、doc/tab ID、个人路径、真实IP或位置。使用现有权限子集scripting/tabs/storage及localhost host，无WAR。收尾复用未变生产输入的VG-014门禁，实际运行新研究脚本与静态检查。
