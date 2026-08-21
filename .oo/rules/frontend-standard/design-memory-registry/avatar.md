# Avatar design memory

本文件承载 Avatar 模块的项目级设计记忆正文，由 [design-memory-registry.md](../design-memory-registry.md) 路由。规则保持当前状态措辞；实现入口与验证边界仍以各条 Ownership / source / exceptions / enforcement 为准。

### OW-DM-016 — Avatar 几何表情参数化与稳定过渡

- Revision / status / scope: 6 / ACTIVE / OneWorks project，`assets/avatar` 交互预览中的几何表情编辑。
- Rule / examples: 眼睛支持圆角长方形和椭圆类型；圆角长方形除宽度、高度、间距和旋转角度外还必须可调整圆角比例。眼睛角度分为共同旋转与左 / 右眼独立倾斜，单眼倾斜作为叠加在共同旋转上的偏移，使整体朝向和不对称表情可以同时调整。所有表情轮廓在身体曲面投影前必须充分细分，圆角长方形看似笔直的四条边也必须逐点采样，不能只投影端点后让 SVG 以屏幕直线连接。鼻子可独立启用，并支持倒三角、椭圆和圆角类型以及尺寸、垂直位置与旋转。嘴巴可独立启用并以弧度作为主要表情参数，正值表示微笑、零值表示平直、负值表示下弯，同时保留宽度、厚度与垂直位置。所有参数持久化到 URL；连续参数通过稳定的几何插值过渡，系统启用 reduced motion 时直接更新终态；Default 动作必须恢复完整基线配置并使用 48px 紧凑图标按钮，不占据大卡片空间。正例是整体旋转 8° 后仍可将左眼额外设为 -24°、右眼设为 18°，并在动画关键帧间平滑过渡；大角度侧视时眼睛长边仍随球面形成连续弧线。反例是两只眼只能同步倾斜、单眼参数替换而不是叠加共同旋转、只投影眼睛边缘两个端点造成直线弦、参数瞬间跳变、刷新后丢失数值、用像素图替代几何表情，或让 Default 重置动作以大尺寸展示卡抢占面板。
- Ownership / source / exceptions / enforcement: 规则由 `assets/avatar/AGENTS.md`、`AvatarControls.tsx`、`InteractiveAvatar.tsx` 与 `avatarGeometry.ts` 共同拥有；来源为用户 2026-08-21 要求几何眼睛支持宽高、间距、旋转与动画，随后要求增加鼻子和嘴巴配置，并进一步明确眼睛圆角 / 椭圆、鼻子类型和嘴巴微笑弧度，最终将 Default 入口收紧为 48px；用户对照参考站的大角度侧视截图后进一步指出眼睛轮廓必须真实沿曲面弯曲，并明确要求可以单独调整某一只眼睛的倾斜角度。默认参数、允许范围和形状枚举由 Avatar 模块实现单点拥有；由 eyeRot / eyeLeftRot / eyeRightRot URL 往返、旧动画零偏移兼容、Default 重置、选择器 / 滑杆可访问名称、48px DOM 尺寸、曲面边界细分的几何断言、动画插值单测、production build 和用户视觉验收执行。

### OW-DM-017 — Avatar 编辑与相机模式边界

- Revision / status / scope: 4 / ACTIVE / OneWorks project，`assets/avatar` 交互预览舞台与导出入口。
- Rule / examples: Avatar 舞台默认处于无画框编辑模式，左上工具栏持续提供相机入口；进入相机模式后才显示固定尺寸的边框、底色与导出工具，同时隐藏右上角保存预设动作，避免把编辑命令混入拍摄构图。Style 面板拥有相机底色以及正方形、圆角正方形、圆形取景框配置。编辑模式允许旋转、放大或移位后的头像越过名义 SVG viewport 完整展示，只有相机模式按取景框裁切。模式、底色和取景框形状均持久化到 URL，模式或形状切换不得改变头像姿态、位置、大小或表情参数。正例是编辑时大角度方形头像可超出隐形画布，点击相机后原位按所选轮廓裁切并只显示拍摄所需导出工具；反例是编辑模式仍截断头像、默认展示导出条和装饰画框、拍摄画面仍叠加保存预设按钮，或切换相机 / 取景框时头像发生位移 / 缩放。
- Ownership / source / exceptions / enforcement: 规则由 `assets/avatar/AGENTS.md`、`App.tsx`、`App.scss`、`InteractiveAvatar.scss`、`AvatarControls.tsx` 与 `ExportToolbar` 共同拥有；来源为用户 2026-08-21 明确要求导出工具默认隐藏、以左侧相机按钮切换相机模式、非相机模式不展示边框和背景并支持配置相机底色，随后指出编辑模式不应限制头像显示范围、要求取景框支持圆角正方形、圆形等类型，并要求拍摄模式隐藏舞台右上保存图标。由默认 query 解析、camera / cameraBg / cameraFrame URL 往返、编辑 / 相机 overflow computed style、相机按钮与取景框选择器可访问状态、条件化保存动作、production build 和用户对各状态的视觉验收执行。

### OW-DM-018 — Avatar 几何表情阴影参数

- Revision / status / scope: 2 / ACTIVE / OneWorks project，`assets/avatar` Effects 面板与几何表情阴影。
- Rule / examples: Face shadow 启用后必须支持方向、距离、柔化和透明度配置，并一致应用到眼睛以及已启用的鼻子和嘴巴；开关和参数持久化到 URL。面部主体保持全不透明的曲面贴花观感；阴影的屏幕投影距离和透明度必须随局部曲面法线缩减，在接近轮廓切线时消失，避免阴影与表情分离后形成内凹孔洞错觉。正例是正面调整阴影方向时所有可见表情部件同步移动，转到侧面后阴影平滑贴回表面且眼睛仍是清晰实色贴花；反例是只有眼睛响应、阴影偏移写死、侧面仍保留固定距离的重复形状、柔化影响头像本体，或刷新后恢复默认参数。
- Ownership / source / exceptions / enforcement: 规则由 `assets/avatar/AGENTS.md`、`AvatarControls.tsx`、`InteractiveAvatar.tsx`、`App.tsx` 与 `avatarGeometry.ts` 共同拥有；来源为用户 2026-08-21 明确要求 Face shadow 支持配置阴影参数，随后指出大角度侧视时眼睛出现内凹错觉，并指定参考站的曲面贴花效果作为视觉方向；只抽象可见层叠规律，不复制参考代码、素材或角色配置。默认值与范围由 Avatar 模块单点拥有；由 shadowDir / shadowDist / shadowSoft / shadowOpacity URL 往返、滑杆可访问名称、切线角阴影衰减、production build 和用户视觉验收执行。

### OW-DM-019 — Avatar 视图状态恢复与默认占比

- Revision / status / scope: 1 / ACTIVE / OneWorks project，`assets/avatar` 交互预览的整体视图状态。
- Rule / examples: 头像的 yaw、pitch、整体 X/Y 位置、整体缩放和 Rotate / Move 模式必须持久化到 URL，刷新或分享链接后恢复完整构图；缺少这些参数的链接使用模块默认值，其中圆角身体的初始可见尺寸约占画布 80%。正例是旋转、移位、缩放后刷新仍保持原构图，旧链接打开时头像以约 80% 占比居中；反例是只保存表情参数、刷新后回正 / 回中 / 缩小，或把缺失的 query 参数通过 `Number(null)` 误解析为 0。
- Ownership / source / exceptions / enforcement: 规则由 `assets/avatar/AGENTS.md`、`App.tsx` 与 `InteractiveAvatar.tsx` 共同拥有；来源为用户 2026-08-21 明确要求交互头像状态写入 URL，并将初始尺寸提高到整体约 80%。默认 scale 与移动 / 缩放边界由 `InteractiveAvatar` 单点拥有；由 mode / yaw / pitch / positionX / positionY / scale URL 往返、缺失参数 fallback、production build 和用户刷新前后视觉验收执行。

### OW-DM-020 — Avatar 本地预设历史与截图

- Revision / status / scope: 4 / ACTIVE / OneWorks project，`assets/avatar` 舞台保存入口与 Build 面板历史列表。
- Rule / examples: 舞台右上角使用与现有工具一致的图标按钮保存当前预设；每条预设必须包含当时交互 SVG 的栅格截图和完整 URL 配置，并持久化到浏览器本地。Build 面板顶部以 48px 固定尺寸横向历史展示，每项直接显示头像截图，不增加卡片底色、内边距、时间或元数据；缩略项点击边界和选中主色边框必须跟随该预设自己的正方形、圆角方形或圆形相框几何。点击缩略图一次性恢复身体、表情、姿态、位置、缩放、配色、相机、灯光、阴影、交互和导出状态，恢复后仍由正常状态到 URL 的同步链路负责，不引入第二套配置状态。正例是圆形 48px 截图显示圆形选中框、正方形截图显示直角选中框，刷新页面历史仍在且点击旧缩略图恢复完整构图；反例是用统一大尺寸方形卡片包住所有截图、只保存表情参数、用通用占位图冒充截图、历史无限拉长面板、刷新后丢失，或点击预设后 URL 与画面分叉。
- Ownership / source / exceptions / enforcement: 规则由 `assets/avatar/AGENTS.md`、`App.tsx`、`AvatarControls.tsx`、`savedAvatarPresets.ts` 与对应样式共同拥有；来源为用户 2026-08-21 要求 Build 顶部展示历史保存设定、舞台右上角增加保存按钮并记录截图，随后明确历史项直接展示保存头像且选中只加边框，指出不同相框截图的历史边界必须匹配各自形状，并将缩略图尺寸明确收紧为 48px。预设仅保存在当前浏览器，不进入分享 URL 或服务端同步；由 localStorage 数据守卫、历史数量上限、截图 data URL、query 相框兼容解析、48px 缩略项 DOM / computed style、完整 query 解析恢复、可访问按钮名称、production build 和用户对保存 / 刷新 / 恢复流程的视觉验收执行。

### OW-DM-021 — Avatar 关键帧动画编辑与本地回放

- Revision / status / scope: 12 / ACTIVE / OneWorks project，`assets/avatar` 舞台 Animation 入口、整宽底部时间线、内置预设与历史动画。
- Rule / examples: 舞台右下角 Animation 入口展开位于完整工作区底部、横跨头像舞台与右侧控制栏的时间线，上方两栏一起为动画区让出空间，头像继续通过原有 Rotate / Move 和面部控件调整；时间线不得作为仅属于左侧舞台的内嵌浮层。面板以带图标的 Create 和 Playback 两个 tab 分隔关键帧创作与回放，tab 已拥有区域语义时不在其左侧重复 Animation 标题；同一标题行左侧拥有 tabs，播放 / 停止和仅 Create 可见的保存图标固定在最右端，不在右侧设置卡内重复动作。每个新关键帧以透明 PNG 记录当时头像缩略图，不填充相机底色、不套用正方形 / 圆角方形 / 圆形相框裁切；缩略项固定为 48px 并使用与相机配置无关的统一圆角选中边界，且可以独立删除。截图只用于识别，不参与动画求值；关键帧的可执行状态仍只包含整体 X/Y 位置、yaw/pitch 朝向和完整几何面部表情，不记录或驱动身体形状、配色、相机、光照与阴影外观。每次开始播放时，以当前头像 X/Y 位置与 yaw/pitch 朝向重新锚定时间线：把当前状态与第一帧的变换差应用到全部帧，只保留动画内部的相对移动和转动；除非某动画未来显式声明锁定变换，否则用户在播放前重新构图后不得跳回动画选中或录制时的旧坐标。Playback 是不区分来源的统一动画库，内置与本地保存动画使用相同层级，每项通过同一交互头像渲染器直接展示当前身体、配色、光照和阴影外观，不展示时长或独立文字区，只在头像右下角悬浮动画名称。选择任一动画时留在 Playback，在右侧打开显示真实帧缩略图、时长、once / loop 行为和缓动曲线的工具区，并立即循环播放；同时用所选动画替换共享编辑草稿，但替换确认只取决于当前编辑区是否已有用户创建、保存或修改的内容，当前编辑区是空白或未修改内置动画时直接替换，所选来源是否内置不影响判断。内置库至少覆盖 Idle、Blink、Listening、Nod、Thinking、Searching、Working、Happy、Curious、Surprised、Bored、Sad、Laughing、Playful、Excited 和 Celebrate，并相对于点击时的当前位置、朝向和表情生成确定性关键帧，允许之后切到 Create 继续编辑和保存；内置帧可提供归一化非等距时间点，播放对每一帧段单独应用缓动，使长凝视、220–420ms 快速眨眼、短回弹和结束复位保持自然节奏，而不是把所有帧平均分时或用一次全局缓动扭曲整条时间线。内置及选中的历史动画都要在不扰动主舞台的离屏区域通过同一交互头像渲染器与透明截图管线为每一帧生成各不相同的真实缩略图。正例是移动头像后再次点击播放，第一帧从新位置开始且后续仍保留动画相对漂移；反例是把播放 / 保存埋在右侧卡片底部、把 Presets / Saved 分成两栏、显示时长和卡片式文字区、用播放三角代替模型预览、选中库项后跳到 Create、把所有动作帧等距分配、Duration 横跨整条时间线、重复 Animation 标题、关键帧无法删除或沿用圆形相机截图、内置关键帧退化成数字占位或复用同一张当前截图、内置动作把头像拉回旧构图或固定原点，或在尚无模型契约时提前引入骨骼 / 部件绑定。
- Ownership / source / exceptions / enforcement: 规则由 `assets/avatar/AGENTS.md`、`App.tsx`、`AnimationPanel.tsx`、`avatarAnimations.ts`、`savedAvatarPresets.ts`、`InteractiveAvatar.tsx` 与对应样式共同拥有；来源为用户 2026-08-21 要求右下角 Animation 入口、下方关键帧面板、动作调整、保存 / 播放关键点及历史动画回放，明确当前普通动画只控制物体位置、朝向与面部表情且暂不考虑特定模型组成部分绑定，随后要求面板横跨完整工作区、将创建 / 回放拆成 tab、关键帧使用真实截图，并进一步要求帧可删除、缩略图宽度及选中形状与 saved preset 一致；用户又要求把播放和保存移动到 tabs 区域最右侧，以指定参考站重新校准动画自然度和表情丰富度，并要求单眼倾斜进入可编辑关键帧以构成真实不对称表情，之后明确 Playback 预设应向下换行并纵向滚动、动画整体节奏应放慢。内置预设只抽象参考站可见的长凝视、轻微呼吸、快速眨眼、表情组合和反应节奏，不复制其代码、素材或角色配置。动画和历史仅保存在当前浏览器，不进入分享 URL；由 workspace grid placement、跨栏 DOM 几何、tabs / header actions DOM 顺序、48px 相框感知缩略项、纵向 library overflow、删除状态更新、非等距帧 offset 单测、左右眼角度插值、内置预设字段白名单和相对状态单测、截图 data URL、localStorage 数据守卫、逐段插值函数、播放期间面部直达渲染、手动交互中断、production build、单元测试和用户视觉验收执行。

### OW-DM-022 — Avatar 侧栏分段按钮导航

- Revision / status / scope: 1 / ACTIVE / OneWorks project，`assets/avatar` 右侧设置栏一级导航。
- Rule / examples: Build、Body、Style 和 Effects 使用带完整边界的四段按钮式 tab，保留既有图标、等宽槽位、键盘 tab 语义和填充选中态，不使用仅靠底部横线指示的导航。正例是四个按钮共享一个有边界的分段容器，当前项用主色软底明确选中；反例是裸文字加下划线、选中态改变槽位尺寸，或把一级导航改成无语义普通按钮。
- Ownership / source / exceptions / enforcement: 规则由 `assets/avatar/AGENTS.md`、`AvatarControls.tsx` 与 `AvatarControls.scss` 共同拥有；来源为用户 2026-08-21 明确要求右侧顶部 tab 改为按钮样式切换。由 role / aria-selected 语义、四等分 DOM 几何、边框与选中态 computed style、production build 和用户视觉验收执行。

### OW-DM-023 — Avatar 舞台工具与临时平移手势

- Revision / status / scope: 3 / ACTIVE / OneWorks project，`assets/avatar` 舞台工具栏、控制栏可见性、主题与拖拽模式。
- Rule / examples: 舞台左上只保留相机入口；右上动作行依次承载保存或拍摄导出、GitHub、亮暗主题和侧栏折叠 / 展开，侧栏动作始终位于最右端。首次加载跟随系统主题，用户手动切换后本次页面使用明确的亮或暗主题。折叠只隐藏右侧控制栏，舞台占满可用宽度，整宽 Animation 面板仍保持工作区级布局。头像画布使用上下对称的舞台内边距垂直居中，左下 Rotate / Move 与右下 Animation 是绝对定位浮层，不为其额外预留底部排版空间；打开 Animation 或进入相机模式后，上下留白仍应一致。Rotate / Move 使用舞台左下角纯图标分段按钮并保留 tooltip、可访问名称和选中状态；主键拖拽遵循当前选项，右键拖拽、macOS 触控板辅助点击拖拽以及双击后按住拖拽只在本次手势临时平移，不改写选中的主拖拽模式。正例是编辑模式左上只有相机、右上最右按钮折叠侧栏，相机圆框在舞台内上下居中，Rotate 仍选中时右键拖动头像位置且松开后普通左键继续旋转；反例是相机与全局动作混在左上、拍摄导出仍留在左侧、折叠按钮夹在右侧动作中间、为底部按钮增加额外 padding 导致头像上移、右键弹出浏览器菜单、临时平移永久切成 Move，或折叠控制栏后动画面板错位。
- Ownership / source / exceptions / enforcement: 规则由 `assets/avatar/AGENTS.md`、`App.tsx`、`App.scss`、`main.tsx`、`AvatarControls.tsx` 与 `InteractiveAvatar.tsx` 共同拥有；来源为用户 2026-08-21 明确要求左上增加侧栏折叠、GitHub、系统跟随亮暗主题，Rotate / Move 移到左下并去文字，以及右键和 macOS 触控板双击拖拽临时平移，随后将左上收敛为单一相机入口，并要求其余动作移至右上且折叠侧栏位于最右端。主题与控制栏折叠是页面 UI 偏好，不写入头像分享 URL；由系统 media query、`html.dark` token 消费、ARIA / tooltip、workspace grid、pointer button / click-count 路由、contextmenu 抑制、production build 和用户视觉验收执行。

### OW-DM-024 — Avatar 可调毛玻璃工作面板

- Revision / status / scope: 2 / ACTIVE / OneWorks project，`assets/avatar` 桌面端右侧控制栏与整宽底部 Animation 面板。
- Rule / examples: 右侧控制栏和底部 Animation 面板使用同一层级的半透明毛玻璃表面，以细边界、背景模糊和适度饱和度维持与舞台的空间关系，不使用完全不透明的大色块把工作区割裂。桌面端控制栏从左边界拖拽调宽，Animation 面板从上边界拖拽调高；拖拽柄支持键盘方向键和双击恢复默认值，并在窄屏单列布局隐藏。Playback 头像库在可用宽度内自动换行并仅纵向滚动。正例是扩大底部面板后出现更多向下排列的动画行、调整侧栏宽度时舞台实时让出空间且所有控件仍可用；反例是动画头像横向无限滚动、面板尺寸写死、拖拽柄遮挡 tab，或毛玻璃导致文字与滑杆对比不足。
- Ownership / source / exceptions / enforcement: 规则由 `assets/avatar/AGENTS.md`、`App.tsx`、`App.scss`、`AvatarControls.tsx`、`AvatarControls.scss`、`AnimationPanel.tsx` 与 `AnimationPanel.scss` 共同拥有；来源为用户 2026-08-21 明确要求动画列表改为纵向排列与滚动、动画面板可拖拽调高、控制栏可拖拽调宽，并将两个面板改成透明毛玻璃效果，随后要求动画预览行自适应分配 gap 且左右不留残余空块。尺寸偏好属于页面 UI 状态，不写入头像分享 URL；由 CSS flex-wrap / space-between、grid custom property、pointer capture、separator ARIA 与键盘交互、桌面 / 窄屏 media query、overflow computed style、production build 和用户视觉验收执行。
