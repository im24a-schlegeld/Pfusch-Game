import type { ReactNode } from 'react';
export default function ColorSection({title,value,children}:{title:string;value:string;children:ReactNode}){
  return <details className="v40-colors"><summary><i style={{background:value}}/><span>{title}</span><b aria-hidden="true">⌄</b></summary><div className="v40-color-content">{children}</div></details>;
}
