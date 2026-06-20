import type { Metadata } from "next";
import "./globals.css";
import "./student.css";

export const metadata: Metadata = {
  title: "SkillSpark — Recorded videos",
  description: "Recorded-video learning workspace for students and administrators.",
};

// Some browser extensions / built-in form-helpers (Edge "Form Fill", Honey,
// Chinese-language form fillers) inject an `fdprocessedid` attribute on every
// form control AFTER the SSR HTML lands but BEFORE React hydrates. React
// then flags it as a hydration mismatch even though our app isn't responsible.
//
// Two-pronged defense:
//   1. Replace setAttribute on the Element prototype so direct calls become
//      no-ops. Catches most extensions.
//   2. Silence the specific hydration warning in console.error if anything
//      still slips through (extensions that cached the original setAttribute
//      reference before our patch ran).
const STRIP_FDPROCESSEDID = `(function(){
try{var sa=Element.prototype.setAttribute;Element.prototype.setAttribute=function(n,v){if(n==='fdprocessedid'||(typeof n==='string'&&n.toLowerCase()==='fdprocessedid'))return;return sa.call(this,n,v)};}catch(e){}
try{var sn=Element.prototype.setAttributeNS;Element.prototype.setAttributeNS=function(ns,n,v){if(typeof n==='string'&&n.toLowerCase().indexOf('fdprocessedid')!==-1)return;return sn.call(this,ns,n,v)};}catch(e){}
try{if(typeof MutationObserver!=='undefined'){new MutationObserver(function(m){for(var i=0;i<m.length;i++){if(m[i].attributeName==='fdprocessedid'){try{m[i].target.removeAttribute('fdprocessedid')}catch(_){}}}}).observe(document.documentElement,{attributes:true,attributeFilter:['fdprocessedid'],subtree:true})}}catch(e){}
try{var rewrap=function(){var oe=console.error;if(oe.__fdpwrapped)return;var w=function(){var s=arguments[0];if(typeof s==='string'&&s.indexOf('fdprocessedid')!==-1)return;if(typeof s==='string'&&s.indexOf('hydrated')!==-1){try{if(JSON.stringify(arguments).indexOf('fdprocessedid')!==-1)return}catch(_){}}return oe.apply(this,arguments)};w.__fdpwrapped=true;console.error=w};rewrap();setTimeout(rewrap,0);setTimeout(rewrap,100);setTimeout(rewrap,500);}catch(e){}
})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Anton&family=Inter:wght@300;400;500;600;700&family=Oswald:wght@500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Fraunces:ital,opsz,wght@0,9..144,400..700;1,9..144,400..700&family=Schibsted+Grotesk:ital,wght@0,400..900;1,400..900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <script dangerouslySetInnerHTML={{ __html: STRIP_FDPROCESSEDID }} />
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
