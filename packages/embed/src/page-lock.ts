/** Stops page scrolling and makes other top-level elements (even ones added later) inert so focus stays in `dialog`; returns the restorer. */
export function lockPage(dialog: Element): () => void {
  const root = document.documentElement;
  const body = document.body;
  const { scrollX, scrollY } = window;
  const previousOverflow = root.style.overflow;
  const { position, top, left, right, paddingRight } = body.style;

  /** Pads the body by the scrollbar width so the page does not shift when the scrollbar disappears. */
  const scrollbarWidth = window.innerWidth - root.clientWidth;
  if (scrollbarWidth > 0) body.style.paddingRight = `calc(${getComputedStyle(body).paddingRight} + ${scrollbarWidth}px)`;
  root.style.overflow = "hidden";
  /** iOS Safari ignores `overflow: hidden` on the page, so the body is also fixed in place at the current scroll position. */
  body.style.position = "fixed";
  body.style.top = `-${scrollY}px`;
  /** Shifted by the horizontal scroll with an unchanged width, so a page scrolled sideways stays where it was. */
  body.style.left = `-${scrollX}px`;
  body.style.right = `${scrollX}px`;

  const madeInert: Element[] = [];
  const makeInert = (element: Element) => {
    if (element === dialog || element.hasAttribute("inert")) return;
    element.setAttribute("inert", "");
    madeInert.push(element);
  };
  for (const element of Array.from(body.children)) makeInert(element);
  const added = new MutationObserver((records) => {
    for (const record of records) for (const node of record.addedNodes) if (node instanceof Element) makeInert(node);
  });
  added.observe(body, { childList: true });

  return () => {
    added.disconnect();
    for (const element of madeInert) element.removeAttribute("inert");
    root.style.overflow = previousOverflow;
    Object.assign(body.style, { position, top, left, right, paddingRight });
    window.scrollTo({ left: scrollX, top: scrollY, behavior: "instant" });
  };
}
