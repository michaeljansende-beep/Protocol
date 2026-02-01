let mediaRecorder,timerInt,startTime;
const $=id=>document.getElementById(id);
const btn=$("btnRecord"),timer=$("timer"),file=$("audioFile");

btn.onclick=async()=>{
 if(!mediaRecorder||mediaRecorder.state==="inactive"){
  const stream=await navigator.mediaDevices.getUserMedia({audio:true});
  mediaRecorder=new MediaRecorder(stream);
  mediaRecorder.start();
  startTime=Date.now();
  btn.classList.add("active");
  btn.textContent="■ Aufnahme stoppen";
  timerInt=setInterval(()=>{const s=Math.floor((Date.now()-startTime)/1000);timer.textContent=String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0")},500);
 }else{
  mediaRecorder.stop();
  clearInterval(timerInt);
  btn.classList.remove("active");
  btn.textContent="● Aufnahme starten";
 }
};

file.onchange=()=>{const f=file.files[0];if(f){$("player").src=URL.createObjectURL(f)}};
