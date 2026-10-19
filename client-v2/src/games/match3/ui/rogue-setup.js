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
import { ASCENSIONS, MAX_ASCENSION } from '../rogue/ascension.js';

/**
 * 渲染入口选择屏
 * @param {HTMLElement} container - 承载屏内容的容器（会被整体替换）
 * @param {object} opts
 * @param {Array} opts.characters - CHARACTERS 定义表
 * @param {string[]} opts.unlocked - 已解锁角色 id 列表
 * @param {(char:object)=>({label:string,have:number,need:number,done:boolean}|null)} opts.unlockOf
 *   未解锁角色的进度（已解锁角色返回 null）
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
        const kit = [
            char.startBonus?.moves ? `+${char.startBonus.moves} 步` : null,
            char.startBonus?.colorCut ? `${6 - char.startBonus.colorCut} 色起手` : null,
            char.startBonus?.scoreMult ? `得分 ×${char.startBonus.scoreMult}` : null,
            char.startBonus?.goalMult ? `目标 ×${char.startBonus.goalMult}` : null,
        ].filter(Boolean);
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
            el('span', { class: 'm3-setup-card-icon' }, owned ? char.icon : '🔒'),
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
                kit.length > 0 ? el('span', { class: 'm3-setup-card-kit' }, `起手：${kit.join(' · ')}`) : null,
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

    /** 进阶等级：一排按钮 0..maxAscension；超出的档位不渲染，另给一句「下一阶怎么解锁」 */
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
        const mods = sel.ascension > 0
            ? ASCENSIONS.slice(0, sel.ascension).map((e) => `Lv.${e.lv} ${e.desc}`)
            : ['无额外修正（与标准难度逐位一致）'];
        return [
            el('div', { class: 'm3-setup-asc-row' }, ...btns),
            el('div', { class: 'm3-setup-asc-note' }, `当前：${ascensionLabel(sel.ascension)}`, el('br'), ...mods.map((m) => el('div', {}, m))),
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
