// Only durably prepaid permits enter these isolate-local pools. Lost/evicted
// pools leak allowance conservatively; they never restore or duplicate it.
export interface PermitPool {remaining:number;next:number}
export const permitPool=():PermitPool=>({remaining:0,next:1});
export async function consumePermits(pool:PermitPool,count:number,reserve:(minimum:number,wanted:number)=>Promise<number>) {
 const cached=Math.min(count,pool.remaining);
 pool.remaining-=cached;
 const missing=count-cached;
 if(!missing)return;
 const wanted=Math.max(missing,pool.next);
 pool.next=Math.min(256,pool.next*8);
 // No shared pending I/O or request object: concurrent callers each acquire
 // their own durable grants. Cached permits are claimed before any await.
 const granted=await reserve(missing,wanted);
 if(!Number.isSafeInteger(granted)||granted<missing)throw Error('Invalid permit grant');
 pool.remaining+=granted-missing;
}
