const{app,BrowserWindow}=require("electron");
const path=require("path");
function createWindow(){
  const win=new BrowserWindow({width:800,height:600,webPreferences:{nodeIntegration:false},title:"Perform security review Secure data storage and encryption"});
  win.loadFile(path.join(__dirname,"../www/index.html"));
}
app.whenReady().then(createWindow);
app.on("window-all-closed",()=>{if(process.platform!=="darwin")app.quit()});