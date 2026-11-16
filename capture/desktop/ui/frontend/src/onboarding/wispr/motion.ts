export const dunkDuration=1350;
export const confirmationHold=1200;
function mix(points:number[][],time:number):number[] {
  for(let i=1;i<points.length;i++)if(time<=points[i][0]){
    const a=points[i-1],b=points[i],fraction=Math.max(0,Math.min(1,(time-a[0])/(b[0]-a[0])));
    const ease=fraction*fraction*(3-2*fraction);
    return a.slice(1).map((value,j)=>value+(b[j+1]-value)*ease);
  }
  return points.at(-1)!.slice(1);
}
export function dunkFrame(time:number){
  const frog=mix([[0,5,50,0,1],[140,5,58,0,.94],[500,130,-22,-8,1],[720,150,-5,0,1],[900,155,12,6,1],[1100,95,65,0,1],[1350,95,65,0,1]],time);
  const tile=mix([[0,132,94,-8,1],[140,132,102,-8,1],[500,315,12,12,1],[720,326,102,2,1],[880,326,178,5,0],[1350,326,220,5,0]],time);
  return {frog:`translate(${frog[0]}px,${frog[1]}px) rotate(${frog[2]}deg) scaleY(${frog[3]})`,
    pose:time<180?0:time<720?1:time<1050?2:3,
    tile:`translate(${tile[0]}px,${tile[1]}px) rotate(${tile[2]}deg)`,opacity:tile[3],
    impact:time>720&&time<930?Math.sin((time-720)/210*Math.PI*4)*3:0,
    spark:time>735&&time<1030};
}
