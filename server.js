const http=require("http");
const fs=require("fs");
const path=require("path");
const PORT=process.env.PORT||3000;
const MIME={".html":"text/html",".css":"text/css",".js":"application/javascript",".json":"application/json",".png":"image/png",".jpg":"image/jpeg",".ico":"image/x-icon",".svg":"image/svg+xml"};
const server=http.createServer((req,res)=>{
  let url=req.url.split("?")[0];
  if(url==="/")url="/index.html";
  const filePath=path.join(__dirname,"www",url);
  const ext=path.extname(filePath);
  fs.readFile(filePath,(err,data)=>{
    if(err){res.writeHead(404);res.end("Not found");return;}
    res.writeHead(200,{"Content-Type":MIME[ext]||"text/plain","Access-Control-Allow-Origin":"*"});
    res.end(data);
  });
});
server.listen(PORT,()=>{
  console.log("
  "+ea+" is running!"
);
  console.log("  Open: http://localhost:"+PORT+"\n");
});