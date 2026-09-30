/** Decorative only: the buttons own every pointer and keyboard interaction. */
export default function LightWave(){
 const paths={
  desktop:'M -80 90 C 0 90, 18 116, 90 104 S 175 42, 245 82 S 321 126, 389 103 S 481 42, 547 81 S 621 127, 688 104 S 780 41, 846 80 S 925 127, 989 103 S 1080 42, 1150 81 S 1250 124, 1300 80',
  mobile:'M -40 76 C 5 76, 30 42, 65 64 S 109 99, 150 71 S 198 46, 238 70 S 285 95, 314 77 C 354 47, 355 119, 320 119 L 47 119 C 12 119, 1 140, 27 153 C 47 166, 55 142, 88 156 S 135 187, 173 159 S 224 141, 258 164 S 314 185, 390 158'
 };
 return <div className="dock-light-wave" aria-hidden="true">{Object.entries(paths).map(([kind,d])=><svg className={`wave-${kind}`} viewBox={kind==='desktop'?'0 0 1200 120':'0 0 350 185'} preserveAspectRatio="none" key={kind}><defs><linearGradient id={`wave-spectrum-${kind}`} x1="0%" x2="100%"><stop offset="0" stopColor="#82dffb"/><stop offset=".27" stopColor="#a8f2fb"/><stop offset=".53" stopColor="#a39aff"/><stop offset=".78" stopColor="#ed9de8"/><stop offset="1" stopColor="#b8dfff"/></linearGradient><filter id={`wave-blur-${kind}`} x="-25%" y="-160%" width="150%" height="420%"><feGaussianBlur stdDeviation="4"/></filter></defs><path className="wave-guide" d={d}/><g stroke={`url(#wave-spectrum-${kind})`}><path className="wave-tail" d={d} pathLength="1000" filter={`url(#wave-blur-${kind})`}/><path className="wave-core" d={d} pathLength="1000"/><path className="wave-spark" d={d} pathLength="1000"/></g></svg>)}</div>
}
