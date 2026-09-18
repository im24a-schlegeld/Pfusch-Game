export interface Swatch {name:string;value:string}
function lab(hex:string){
  const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);
  const [r,g,b]=rgb;const f=(v:number)=>v>.008856?Math.cbrt(v):7.787*v+16/116;
  const x=f((.4124*r+.3576*g+.1805*b)/.95047),y=f(.2126*r+.7152*g+.0722*b),z=f((.0193*r+.1192*g+.9505*b)/1.08883);
  return [116*y-16,500*(x-y),200*(y-z)];
}
export function perceptualDistance(a:string,b:string){const x=lab(a),y=lab(b);return Math.hypot(...x.map((v,i)=>v-y[i]));}
const names:Swatch[]=[['Nachtschwarz','#181818'],['Anthrazit','#323638'],['Graphit','#555a5e'],['Rauchgrau','#858987'],['Silber','#a6acb0'],['Kreide','#e7e7df'],['Polarweiss','#ffffff'],['Sandstein','#b6a083'],['Bronze','#967847'],['Walnuss','#70523b'],['Bordeaux','#6e273f'],['Kirschrot','#b83232'],['Kupferorange','#dc632e'],['Sonnengelb','#e8bd34'],['Limette','#b8ce47'],['Moosgruen','#596c46'],['Tannengruen','#3e5c52'],['Petrol','#207977'],['Eisblau','#8ab9cf'],['Kobalt','#366bc0'],['Nachtblau','#233c68'],['Flieder','#a487c0'],['Amethyst','#7461a5'],['Violett','#903cca'],['Altrosa','#c982a3']].map(([name,value])=>({name,value}));
export function colorName(value:string){
  let best=names[0],d=Infinity;for(const n of names){const v=perceptualDistance(value,n.value);if(v<d){best=n;d=v;}}
  const l=lab(value)[0]-lab(best.value)[0];return l>13?'Hell'+best.name.toLowerCase():l< -13?'Dunkel'+best.name.toLowerCase():best.name;
}
/** Hide perceptual duplicates only in the chooser. Persisted values and prices remain valid. */
export function visiblePalette<T extends Swatch>(input:readonly T[],selected?:string):T[]{
  const out:T[]=[];for(const c of input){if(!/^#[\da-f]{6}$/i.test(c.value))continue;if(out.every(p=>perceptualDistance(p.value,c.value)>=8))out.push({...c,name:colorName(c.value)});}
  const old=input.find(c=>c.value===selected);if(old&&!out.some(c=>c.value===selected))out.unshift({...old,name:colorName(old.value)+' (aktuell)'});
  const counts=new Map<string,number>();for(const c of out){const n=(counts.get(c.name)||0)+1;counts.set(c.name,n);if(n>1)c.name+=' '+n;}
  return out;
}
