import React from 'react';
import {createRoot} from 'react-dom/client';
import App,{ReplacedWindow} from './App';
import './index.css';
class Boundary extends React.Component<React.PropsWithChildren,{error:boolean}>{state={error:false};static getDerivedStateFromError(){return {error:true}}render(){return this.state.error?<main className="p-8"><h1>No se pudo mostrar el panel</h1><p>Recarga la página para reconstruir el estado. Las órdenes guardadas no se repiten.</p><button onClick={()=>location.reload()}>Recargar</button></main>:this.props.children}}
// Unmounting the panel stops its polling and live streams once a newer window takes over.
function Root(){
 const [replaced,setReplaced]=React.useState(false);
 const onReplaced=React.useCallback(()=>{window.close();setTimeout(()=>setReplaced(true),300)},[]);
 return replaced?<ReplacedWindow/>:<App onReplaced={onReplaced}/>;
}
createRoot(document.getElementById('root')!).render(<Boundary><Root/></Boundary>);
