// mascot/playground.src.js
// NEW FILE: the playground page's own code (controls, stage, video, JSON). The mascot itself is src/mascot/mascot.js.
// Built into mascot/playground.html by `npm run mascot:playground`.
import * as THREE from "three";
import {createMascot, DEFAULTS} from "../src/mascot/mascot.js";

// ---------- settings (sliders) ----------
// the settings Sarah chose (7 Nov 2026); these are the defaults
const S = {...DEFAULTS};
const SLIDERS = [["size","Size",8,30,0.5,"% of height"],["walk","Walk speed",0.5,3,0.1,"heights/s"],["run","Run speed",2,9,0.1,"heights/s"],
  ["outline","Outline",0,6,0.5,"px"],["turn","3D turn",0,1,0.05,"rad"],["lead","Arrive early",0,1,0.05,"s"],["skip","Same spot if closer than",0,3,0.05,"s"],["push","Push to the edge",0,1,0.05,"x"],["intro","Intro size",1,3,0.05,"x"],["sign","Sign size",1.5,9,0.1,"x"],["reach","Sign arm",1,3,0.05,"x"],["jump","Jump up to",0,3,0.1,"heights"],["lean","Lean in",0,0.5,0.02,"rad"],["minShow","Words at least",0.2,1.5,0.05,"s"]];
try{Object.assign(S,JSON.parse(localStorage.getItem("mascot-settings-5")||"{}"))}catch{}
const sl=document.getElementById("sliders");
for(const [k,label,mn,mx,st,unit] of SLIDERS){
  const d=document.createElement("div");d.className="sl";d.title=unit;
  d.innerHTML=`<label for="s-${k}">${label}</label><input type="range" id="s-${k}" min="${mn}" max="${mx}" step="${st}" value="${S[k]}"><output>${S[k]}</output>`;
  const inp=d.querySelector("input"),out=d.querySelector("output");
  inp.oninput=()=>{S[k]=+inp.value;out.textContent=inp.value;try{localStorage.setItem("mascot-settings-5",JSON.stringify(S))}catch{};M.rebuild();legend()};
  sl.appendChild(d);
}

// ---------- stage size ----------
const stage=document.getElementById("stage"),vid=document.getElementById("vid"),gridC=document.getElementById("grid"),glC=document.getElementById("gl");
let W=400,H=711,aspect=9/16,N=20;
function layout(){
  const maxW=stage.parentElement.clientWidth, maxH=Math.max(320,window.innerHeight*0.78);
  W=Math.min(maxW,maxH*aspect);H=W/aspect;stage.style.width=W+"px";stage.style.height=H+"px";
  renderer.setSize(W,H,false);cam.left=0;cam.right=W;cam.top=0;cam.bottom=-H;cam.updateProjectionMatrix();drawGrid();M.setSize(W,H,N);legend();
}
function drawGrid(){
  const dpr=devicePixelRatio||1;gridC.width=W*dpr;gridC.height=H*dpr;const g=gridC.getContext("2d");g.scale(dpr,dpr);g.clearRect(0,0,W,H);
  if(!document.getElementById("showGrid").checked)return;
  g.strokeStyle="rgba(255,255,255,.28)";g.lineWidth=1;g.font=`700 ${Math.max(7,W/N*0.24)}px system-ui`;g.fillStyle="rgba(255,255,255,.55)";
  for(let i=1;i<N;i++){g.beginPath();g.moveTo(i*W/N,0);g.lineTo(i*W/N,H);g.moveTo(0,i*H/N);g.lineTo(W,i*H/N);g.stroke()}
  for(let c=0;c<N;c++)for(let r=0;r<N;r++)g.fillText(String.fromCharCode(65+c)+(r+1),c*W/N+2,r*H/N+W/N*0.28);
}
const cellXY=(name)=>{const c=name.charCodeAt(0)-65,r=parseInt(name.slice(1))-1;return{x:(c+.5)*W/N,y:(r+.5)*H/N}};
// ---------- three ----------
const renderer=new THREE.WebGLRenderer({canvas:glC,antialias:true,alpha:true});renderer.setPixelRatio(devicePixelRatio||1);
const scene=new THREE.Scene(),cam=new THREE.OrthographicCamera(0,W,0,-H,-5000,5000);cam.position.z=1000;
const M=createMascot(THREE,S);scene.add(M.world);
// ---------- time, input, modes ----------
let moves=[],t0=performance.now()/1000,paused=false,pauseAt=0,useVideo=false,loopEnd=0,free=true;
const now=()=>useVideo?vid.currentTime:(paused?pauseAt:performance.now()/1000-t0);
function setMoves(list,{loop=true,start=null}={}){moves=list;M.setMoves(list,start);loopEnd=loop&&list.length?list[list.length-1].t+1.8:0}
function restart(){if(useVideo){vid.currentTime=0;vid.play()}t0=performance.now()/1000;paused=false;document.getElementById("play").textContent="Pause"}
const DEMO=[["J8",0.7,"Stella Revheim",true],["E5",2.5,"Kick out"],["O5",3.7,"Swing hands"],["O15",5.3,"Drop down"],["B19",6.9,"Slide left"],["N9",8.3,"Cross jump"],["Q10",9.1,"Freeze"],["R18",10.5,"Spin"]];
function demo(){free=false;useVideo=false;vid.pause();setMoves(DEMO.map(([c,t,text,name])=>({...cellXY(c),t,text,name:!!name})));restart();legend()}
function fromJSON(){
  try{const j=JSON.parse(document.getElementById("json").value);N=j.grid?.size||20;drawGrid();M.setSize(W,H,N);
    const caps=(j.captions||[]).filter(c=>c.cells?.length).sort((a,b)=>a.from-b.from);
    if(!caps.length)throw new Error("no captions with cells");
    free=false;setMoves(caps.map(c=>({...cellXY(c.cells[0]),t:c.from,text:c.text,name:c.id===1})),{loop:!vid.src}); // caption 1 = the name: the close-up intro
    if(vid.src){useVideo=true;vid.currentTime=0;vid.play()}else restart();
    status(`${caps.length} moves loaded on a ${N}×${N} grid`);legend();
  }catch(e){status("That JSON could not be read: "+e.message)}
}
stage.addEventListener("click",ev=>{
  const b=stage.getBoundingClientRect(),x=ev.clientX-b.left,y=ev.clientY-b.top;
  const R=M.man.root,cur=R.visible&&R.scale.x>0.5?{x:R.position.x,y:-R.position.y}:{x:W/2,y:H*0.85}; // wherever he is right now
  free=true;useVideo=false;vid.pause();t0=performance.now()/1000;paused=false;
  const d=Math.hypot(x-cur.x,y-cur.y)/M.man.h;
  setMoves([{x,y,t:S.lead+d/S.run+0.1,text:document.getElementById("clickText").value||"Here!"}],{loop:false,start:cur});
  legend();
});
document.getElementById("demo").onclick=demo;document.getElementById("useJson").onclick=fromJSON;document.getElementById("restart").onclick=restart;
document.getElementById("play").onclick=e=>{if(useVideo){vid.paused?vid.play():vid.pause();e.target.textContent=vid.paused?"Play":"Pause";return}
  paused=!paused;if(paused)pauseAt=now();else t0=performance.now()/1000-pauseAt;e.target.textContent=paused?"Play":"Pause"};
document.getElementById("showGrid").onchange=drawGrid;
document.getElementById("file").onchange=e=>{const f=e.target.files[0];if(!f)return;vid.src=URL.createObjectURL(f);vid.onloadedmetadata=()=>{aspect=vid.videoWidth/vid.videoHeight;layout();status(`${f.name}: ${vid.videoWidth}×${vid.videoHeight}. Paste its JSON and press "Use JSON".`)}};
document.getElementById("copy").onclick=async()=>{const t=JSON.stringify(S);try{await navigator.clipboard.writeText(t);status("Settings copied: paste them to Claude.")}catch{const o=document.getElementById("copyOut");o.hidden=false;o.value=t;o.select();status("Copy the selected text.")}};
const status=t=>document.getElementById("status").textContent=t;
function legend(){document.getElementById("legend").innerHTML=M.plan.filter(m=>m.t>=0).map(m=>m.items.map((it,j)=>`<span${j?' style="opacity:.75"':""}><b>${it.t.toFixed(2)}s</b> ${it.text} · ${j?"same spot":m.travel?.mode??"start"}</span>`).join("")).join("")}
window.addEventListener("resize",layout);

layout();demo();
// start right away; the sign switches to the comic font when it has loaded (a slow or blocked font never stops the animation)
document.fonts.load('700 40px "Comic Neue"').then(()=>M.refreshText()).catch(()=>{});
window.__mascotRunning=true;
function loop(){let T=now();if(!useVideo&&loopEnd&&T>loopEnd){restart();T=0}const lab=M.frame(T);
  document.getElementById("clock").textContent=`${T.toFixed(2)} s · ${lab} ·`;renderer.render(scene,cam);requestAnimationFrame(loop)}
loop();
