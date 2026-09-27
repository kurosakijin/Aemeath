export const IMAGE_PREFIX="aemeath:image:";
export const SPOILER_IMAGE_PREFIX=IMAGE_PREFIX+"spoiler:";
export const isImageMessage=(body:string)=>body.startsWith(IMAGE_PREFIX+"data:image/")||body.startsWith(SPOILER_IMAGE_PREFIX+"data:image/");
export const isSpoilerImage=(body:string)=>body.startsWith(SPOILER_IMAGE_PREFIX);
export const imageSource=(body:string)=>isSpoilerImage(body)?body.slice(SPOILER_IMAGE_PREFIX.length):isImageMessage(body)?body.slice(IMAGE_PREFIX.length):"";
export const setImageSpoiler=(body:string,spoiler:boolean)=>IMAGE_PREFIX+(spoiler?"spoiler:":"")+imageSource(body);
export function imageFromClipboard(data:DataTransfer){for(const item of Array.from(data.items||[]))if(item.kind==="file"&&item.type.startsWith("image/")){const file=item.getAsFile();if(file)return file}return null}
export async function compressChatImage(file:File){
  if(!file.type.startsWith("image/"))throw new Error("Only image attachments are allowed.");
  if(file.size>15*1024*1024)throw new Error("Choose an image smaller than 15 MB.");
  const bitmap=await createImageBitmap(file),limit=2048,scale=Math.min(1,limit/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement("canvas");
  canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  const context=canvas.getContext("2d");if(!context)throw new Error("Could not prepare this image.");
  context.imageSmoothingEnabled=true;context.imageSmoothingQuality="high";context.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  let quality=.9,blob:Blob|null=null;
  do{blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,"image/webp",quality));quality-=.08}while(blob&&blob.size>280000&&quality>=.58);
  if(!blob)throw new Error("This browser could not compress the image.");
  const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error("Could not read the image."));reader.readAsDataURL(blob!)});
  if(data.length>390000)throw new Error("The compressed image is still too large. Choose a smaller image.");
  return IMAGE_PREFIX+data;
}
