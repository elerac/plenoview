// Mitsuba src/core/spectrum.cpp::spectrum_list_to_srgb, BSD-3-Clause.
// Offline source samples from mitsuba-data/ior/Ag.{eta,k}.spd and Mitsuba CIE tables.
import { readFileSync } from 'node:fs';
const { cmf, eta, k } = JSON.parse(readFileSync(new URL('./data/mitsuba-silver-ior.json', import.meta.url), 'utf8'));
const matrix = [3.240478992462158, -1.5371500253677368, -0.49853500723838806, -0.9692559838294983, 1.8759909868240356, 0.04155600070953369, 0.05564799904823303, -0.20404300093650818, 1.0573110580444336];
function convert(data) {
 let xyz=[0,0,0];
 for(let i=0;i<1000;i++){
  const w=360+i/999*470; let index=0;
  while(index<data.length-2&&data[index+1][0]<=w)index++;
  const [w0,v0]=data[index], [w1,v1]=data[index+1];
  const v=((w-w1)*v0+(w0-w)*v1)/(w0-w1);
  const t=(w-360)*.2; const i0=Math.min(Math.floor(t),93); const f=t-i0;
  for(let c=0;c<3;c++)xyz[c]+=((1-f)*cmf[c*95+i0]+f*cmf[c*95+i0+1])*v;
 }
 xyz=xyz.map(x=>x*470/106.7502593994140625/1000);
 return [0,1,2].map(c=>Math.fround(Math.max(0,matrix[c*3]*xyz[0]+matrix[c*3+1]*xyz[1]+matrix[c*3+2]*xyz[2])));
}
console.log(JSON.stringify({ eta: convert(eta), k: convert(k) }, null, 2));
