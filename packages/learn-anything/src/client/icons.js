import { createElement as h } from 'react'

const paths = {
  route: 'M5 4h10a4 4 0 0 1 0 8H9a4 4 0 0 0 0 8h10M5 1v6M2 4h6M16 17l3 3-3 3',
  target: 'M21 12a9 9 0 1 1-9-9M17 12a5 5 0 1 1-5-5M12 12l9-9M16 3h5v5',
  chart: 'M4 19h16M7 15v-4M12 15V5M17 15V8',
  spark: 'm12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6Z',
  arrow: 'M5 12h14m-5-5 5 5-5 5',
  chevron: 'm9 5 7 7-7 7',
  check: 'm5 12 4 4L19 6',
  book: 'M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1m0-15c3-2 6-2 9-1v15c-3-1-6-1-9 1V5',
  bulb: 'M9 18h6m-5 3h4M8 14a6 6 0 1 1 8 0c-1 1-1 2-1 2H9s0-1-1-2',
  pause: 'M8 5v14M16 5v14',
  minus: 'M5 12h14',
  plus: 'M5 12h14M12 5v14',
}

export function Icon({ name, className = '' }) {
  return h('svg', { className: `la-icon ${className}`, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true },
    h('path', { d: paths[name] ?? paths.spark }))
}
