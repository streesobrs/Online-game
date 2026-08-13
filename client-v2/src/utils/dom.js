/**
 * DOM 辅助函数
 * 提供便捷的元素创建与查询工具。
 */

/**
 * 创建元素
 * @param {string} tag - 标签名，如 'div'、'button'
 * @param {Object} [props] - 属性对象：
 *   - 普通键：setAttribute（'class' 简写为 className；'style' 支持对象合并；'html' 直接设置 innerHTML）
 *   - 'on*' 开头的键：绑定事件监听（如 onClick、onChange）
 * @param {...(string|number|Node|Array)} children - 子节点（字符串/数字自动转文本节点，数组会展开）
 * @returns {HTMLElement}
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);

  Object.entries(props).forEach(([key, value]) => {
    if (value === null || value === undefined || value === false) return;
    if (key === 'class') {
      node.className = value;
    } else if (key === 'style' && typeof value === 'object') {
      Object.assign(node.style, value);
    } else if (key === 'html') {
      node.innerHTML = value;
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      node.setAttribute(key, String(value));
    }
  });

  children.flat().forEach((child) => {
    if (child === null || child === undefined || child === false) return;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  });

  return node;
}

/**
 * 选择单个元素
 * @param {string} selector - CSS 选择器
 * @param {ParentNode} [root=document] - 查询根节点
 * @returns {HTMLElement|null}
 */
export function $(selector, root = document) {
  return root.querySelector(selector);
}

/**
 * 选择多个元素
 * @param {string} selector - CSS 选择器
 * @param {ParentNode} [root=document] - 查询根节点
 * @returns {HTMLElement[]}
 */
export function $$(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}
