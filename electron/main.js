const{app,BrowserWindow}=require("electron");
const path=require("path");
function createWindow(){
  const win=new BrowserWindow({width:800,height:600,webPreferences:{nodeIntegration:false},title:"Implement backend code and API User interface"});
  win.loadFile(path.join(__dirname,"../www/index.html"));
}
app.whenReady().then(createWindow);
app.on("window-all-closed",()=>{if(process.platform!=="darwin")app.quit()});