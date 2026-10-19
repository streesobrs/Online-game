/**
 * 肉鸽入口选择屏（开发方案 3.8–3.10，P5/P6）
 *
 * 进模式前先选：**角色**（起手身份）/ **进阶难度**（0–10 修正叠加）/ **硬核**（禁 meta 加成）。
 * 三者只影响「本轮怎么开始」，不改任何局内规则与数值口径，全部由 showSetup 复核后传给 startRun。
 *
 * 解锁都以 meta（服务端权威）为准：
 * - 角色：靠战绩资格（下传的 stats），**不能花精华买**——避免「养成与角色强度」两套经济打架
 * - 进阶：meta.ascension.max 决定可选范围；进阶 N 需先通关更低阶才逐步解锁
 * - 硬核：通关 1 次后解锁，独立统计、更高精华系数
 *
 * 纯 DOM + CSS，不引框架；只负责渲染与把选择回传，不持有 run 状态（推进在 mode-rogue 里）。
 */
import { el } from '../../../utils/dom.js';
import { ASCENSIONS, MAX_ASCENSION, ascMods } from '../rogue/ascension.js';

/**
 * 渲染入口选择屏
 * @param {HTMLElement} container - 承载屏内容的容器（会被整体替换）
 * @param {object} opts
 * @param {Array} opts.characters - CHARACTERS 定义表
 * @param {string[]} opts.unlocked - 已解锁角色 id 列表
 * @param {(char:object)=>({label:string,have:number,need:number,done:boolean}|null)} opts.unlockOf
 *   未解锁角色的进度（已解锁角色返回 null）
 * @param {(char:object)=>({level:number,runs:number,next:(number|null)})} [opts.masteryOf]
 *   某角色的熟练度（按出战轮数分级，纯展示）
 * @param {number} opts.maxAscension - 最高可选进阶等级（含）
 * @param {(lv:number)=>string} opts.ascensionLabel
 * @param {boolean} opts.hardcoreUnlocked
 * @param {number} opts.hardcoreWins - 硬核通关次数（展示用）
 * @param {string} opts.defaultCharacter
 * @param {number} opts.defaultAscension
 * @param {boolean} opts.defaultHardcore
 * @param {(setup:{characterId:string,ascension:number,hardcore:boolean})=>void} opts.onStart
 * @param {()=>void} [opts.onExit]
 */
export function renderRogueSetup(container, opts) {
    const {
        characters = [],
        unlocked = [],
        unlockOf = () => null,
        masteryOf = () => null,
        maxAscension = 0,
        ascensionLabel = (lv) => (lv > 0 ? `进阶 ${lv}` : '标准难度'),
        hardcoreUnlocked = false,
        hardcoreWins = 0,
        defaultCharacter = characters[0]?.id,
        defaultAscension = 0,
        defaultHardcore = false,
        onStart,
        onExit,
    } = opts;

    // 本地选中状态：初始值做一次合法性回落（未解锁的角色 / 越界的进阶 / 未解锁的硬核都不选）
    let sel = {
        characterId: unlocked.includes(defaultCharacter) ? defaultCharacter : (characters[0]?.id || null),
        ascension: Math.max(0, Math.min(maxAscension, Math.floor(defaultAscension) || 0)),
        hardcore: !!hardcoreUnlocked && !!defaultHardcore,
    };

    /** 角色卡：已解锁可点，未解锁置灰并显示进度 */
    function charCard(char) {
        const owned = unlocked.includes(char.id);
        const on = sel.characterId === char.id;
        const prog = owned ? null : unlockOf(char);
        const accent = char.accent || '#94a3b8';
        // 熟练度（纯展示：按该角色累计出战轮数分级，不接任何强度；压成一行次要信息，钉在卡底对齐）
        const mast = owned ? masteryOf(char) : null;
        const mastText = mast
            ? (mast.next === null
                ? `熟练满级 · 出战 ${mast.runs} 轮`
                : `熟练 Lv.${mast.level} · 出战 ${mast.runs}/${mast.next} 轮`)
            : null;
        return el(
            'button',
            {
                class: `m3-setup-card${on ? ' m3-setup-card--on' : ''}${owned ? '' : ' m3-setup-card--locked'}`,
                type: 'button',
                disabled: !owned,
                onClick: () => {
                    if (sel.characterId === char.id) return;
                    sel.characterId = char.id;
                    paint();
                },
            },
            el('span', {
                class: 'm3-setup-card-icon',
                // 角色专属配色（起手身份的辨识色；emoji 用中性底色，锁定时不染色）
                style: owned ? { background: `${accent}1f`, color: accent } : null,
            }, owned ? char.icon : '🔒'),
            el(
                'span',
                { class: 'm3-setup-card-main' },
                el(
                    'span',
                    { class: 'm3-setup-card-head' },
                    el('span', { class: 'm3-setup-card-name' }, char.name),
                    el('span', { class: 'm3-setup-card-style' }, char.style),
                ),
                el('span', { class: 'm3-setup-card-desc' }, char.desc),
                mastText ? el('span', { class: 'm3-setup-card-mastery' }, `⭐ ${mastText}`) : null,
                prog && !prog.done
                    ? el(
                        'span',
                        { class: 'm3-setup-card-lock' },
                        `🔒 ${prog.label}（${prog.have}/${prog.need}）`,
                    )
                    : null,
            ),
        );
    }

    /** 进阶等级：按钮 0..maxAscension + 选中等级的累计修正摘要 + 全部等级的逐级说明 */
    function ascRow() {
        const btns = [];
        for (let lv = 0; lv <= maxAscension; lv += 1) {
            const on = sel.ascension === lv;
            btns.push(el(
                'button',
                {
                    class: `m3-setup-asc${on ? ' m3-setup-asc--on' : ''}`,
                    type: 'button',
                    title: lv === 0 ? '标准难度（无修正）' : ASCENSIONS[lv - 1]?.desc || '',
                    onClick: () => {
                        if (sel.ascension === lv) return;
                        sel.ascension = lv;
                        paint();
                    },
                },
                lv === 0 ? '标准' : String(lv),
            ));
        }
        // 已解锁但未通关的更高阶：展示为「未解锁」占位，提示解锁条件
        const nextLv = maxAscension + 1;
        if (nextLv <= MAX_ASCENSION) {
            btns.push(el(
                'button',
                { class: 'm3-setup-asc m3-setup-asc--locked', type: 'button', disabled: true },
                '🔒',
                el('span', { class: 'm3-setup-asc-tip' }, `${nextLv}`),
            ));
        }
        const n = sel.ascension;
        const asc = ascMods(n);
        // 选中等级的「累计修正」摘要：把所有已叠加的修正项折算成人话，回答「选它到底改了啥」
        const summary = n === 0
            ? ['无额外修正（与标准难度逐位一致）']
            : [
                asc.goalMult > 1.0001 ? `所有目标分 +${Math.round((asc.goalMult - 1) * 100)}%` : null,
                asc.moves < 0 ? `每层起手 −${Math.abs(asc.moves)} 步` : null,
                asc.eliteBonus > 0 ? `每区域精英 +${asc.eliteBonus}` : null,
                asc.eliteMult > 1.0001 ? `精英目标分 +${Math.round((asc.eliteMult - 1) * 100)}%` : null,
                asc.bossMult > 1.0001 ? `Boss 血量 +${Math.round((asc.bossMult - 1) * 100)}%` : null,
                asc.shopMult > 1.0001 ? `商店价格 +${Math.round((asc.shopMult - 1) * 100)}%` : null,
                asc.colorFloor > 0 ? `元素种类下限 ${asc.colorFloor} 色` : null,
            ].filter(Boolean);
        // 全部等级的逐级说明：当前已叠加的高亮，未解锁的打锁标——一眼看清整条进阶曲线
        const ladder = ASCENSIONS.map((e) => {
            const locked = e.lv > maxAscension;
            const active = e.lv <= n;
            return el(
                'div',
                { class: `m3-setup-asc-item${active ? ' m3-setup-asc-item--on' : ''}${locked ? ' m3-setup-asc-item--locked' : ''}` },
                el('span', { class: 'm3-setup-asc-item-lv' }, `Lv.${e.lv}`),
                el('span', { class: 'm3-setup-asc-item-desc' }, e.desc),
                locked ? el('span', { class: 'm3-setup-asc-item-lock' }, '🔒') : null,
            );
        });
        return [
            el('div', { class: 'm3-setup-asc-row' }, ...btns),
            el(
                'div',
                { class: 'm3-setup-asc-note' },
                `当前：${ascensionLabel(n)}`,
                el('div', { class: 'm3-setup-asc-summary' }, summary.join(' · ')),
            ),
            el('div', { class: 'm3-setup-asc-ladder-title' }, '各级修正（当前已叠加的高亮）'),
            el('div', { class: 'm3-setup-asc-ladder' }, ...ladder),
            nextLv <= MAX_ASCENSION
                ? el('div', { class: 'm3-setup-asc-hint' }, `🔒 进阶 ${nextLv}：在进阶 ${maxAscension} 通关后解锁`)
                : el('div', { class: 'm3-setup-asc-hint' }, '🔒 已解锁全部进阶，愿试炼不止'),
        ];
    }

    /** 硬核开关：未解锁时置灰并显示进度 */
    function hardcoreRow() {
        const on = sel.hardcore;
        return el(
            'button',
            {
                class: `m3-setup-hard${on ? ' m3-setup-hard--on' : ''}${hardcoreUnlocked ? '' : ' m3-setup-hard--locked'}`,
                type: 'button',
                disabled: !hardcoreUnlocked,
                onClick: () => {
                    if (!hardcoreUnlocked) return;
                    sel.hardcore = !sel.hardcore;
                    paint();
                },
            },
            el('span', { class: 'm3-setup-hard-icon' }, hardcoreUnlocked ? (on ? '🔥' : '🧊') : '🔒'),
            el(
                'span',
                { class: 'm3-setup-hard-main' },
                el('span', { class: 'm3-setup-hard-name' }, `硬核模式${on ? '：已开启' : ''}`),
                el(
                    'span',
                    { class: 'm3-setup-hard-desc' },
                    '禁一切局外养成加成、禁用时光倒流；独立统计与专属成就，精华系数 ×1.5。',
                ),
                !hardcoreUnlocked
                    ? el('span', { class: 'm3-setup-hard-lock' }, '🔒 通关 1 次后解锁')
                    : (hardcoreWins > 0 ? el('span', { class: 'm3-setup-hard-lock' }, `已通关 ${hardcoreWins} 次`) : null),
            ),
        );
    }

    function paint() {
        container.replaceChildren(
            el(
                'div',
                { class: 'm3-head' },
                el('h2', { class: 'm3-title' }, '🎲 肉鸽试炼 · 选择入口'),
                el('p', { class: 'm3-sub' }, '角色决定起手身份，进阶与硬核决定难度与精华系数；强度大头仍在局内 build'),
            ),
            el(
                'div',
                { class: 'm3-setup' },
                el('div', { class: 'm3-setup-group' },
                    el('div', { class: 'm3-setup-group-title' }, '🔥 角色'),
                    el('div', { class: 'm3-setup-cards' }, ...characters.map(charCard))),
                el('div', { class: 'm3-setup-group' },
                    el('div', { class: 'm3-setup-group-title' }, '☠️ 进阶难度'),
                    ...ascRow()),
                el('div', { class: 'm3-setup-group' },
                    el('div', { class: 'm3-setup-group-title' }, '🌟 硬核模式'),
                    hardcoreRow()),
            ),
            el(
                'div',
                { class: 'm3-actions' },
                el(
                    'button',
                    {
                        class: 'm3-btn',
                        type: 'button',
                        disabled: !sel.characterId,
                        onClick: () => onStart?.({ ...sel }),
                    },
                    '⚔️ 开始试炼',
                ),
                el('button', { class: 'm3-btn m3-btn--ghost', type: 'button', onClick: () => onExit?.() }, '返回'),
            ),
        );
    }

    paint();
}
