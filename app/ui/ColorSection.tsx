import type { ReactNode } from 'react';
export default function ColorSection({title,value,children}:{title:string;value:string;children:ReactNode}){
  return <details className="v40-colors"><summary><i style={{background:value}}/><span>{title}</span><b aria-hidden="true"><svg viewBox="0 0 20 20" width="16" height="16" focusable="false"><path d="M5.2 7.4 10 12.2l4.8-4.8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/></svg></b></summary><div className="v40-color-content">{children}</div></details>;
}
