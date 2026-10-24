const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../main.js'),'utf8');
const obsidian={Plugin:class{},ItemView:class{},FileView:class{},Modal:class{}};
const context={module:{exports:{}},require:()=>obsidian};
vm.runInNewContext(source+'\nmodule.exports.typography={spatialParagraphSpacing,spatialParagraphKey,spatialBoxWidth};',context);
const Notebook=context.module.exports,{spatialParagraphSpacing:space,spatialParagraphKey:key,spatialBoxWidth:width}=Notebook.typography;
const paragraph=text=>({innerText:text,textContent:text,style:{}});
const first=paragraph('A coloured character'),second=paragraph('Next line'),third=paragraph('Changed character'),fourth=paragraph('Last line');
const element={style:{},querySelectorAll:()=>[first,second,third,fourth]};
const metrics={fontFamily:'Calibri',fontSizePt:14,lineHeightPt:17.08985,paragraphs:[
 {text:'A coloured character',fontSizePt:14,lineHeightPt:17.08985,emptyBeforePt:0},
 {text:'Next line',fontSizePt:14,lineHeightPt:17.08985,emptyBeforePt:34.1797},
 {text:'Original character',fontSizePt:14,lineHeightPt:17.08985,emptyBeforePt:17.08985},
 {text:'Last line',fontSizePt:11,lineHeightPt:13.42773,emptyBeforePt:17.08985}
]};
const markdown='<span class="tn-import-format" data-tn-color="#5B9BD5" style="color:#5B9BD5">**A coloured character**</span>\n\n\nNext line\n\n\nChanged character\n\n\nLast line';
space(element,markdown,metrics);
assert.equal(element.style.fontSize,'14pt');assert.equal(element.style.lineHeight,'17.08985pt');
assert.equal(first.style.marginBottom,'0pt','HTML colours cannot introduce an extra paragraph gap');
assert.equal(second.style.marginTop,'34.1797pt','two source empty lines survive Markdown blank-line compression');
assert.equal(third.style.marginTop,'22.79px','edited text keeps its preceding Markdown gap when its old source no longer matches');
assert.equal(third.style.marginBottom,'0','a fallback gap must not collapse into the next source paragraph gap');
assert.equal(fourth.style.fontSize,'11pt','paragraph font sizes can differ inside one box');
assert.equal(fourth.style.marginTop,'17.08985pt');
assert.equal(key('[[Notes/Character|**A coloured character**]]'),'A coloured character');
assert.equal(key('<span style="color:red">A &amp; B</span>'),'A & B');
const plugin=new Notebook();let saved=0;plugin.persist=()=>saved++;
const box={id:'main',x:120,y:470,width:600,height:700},other={id:'user',x:900,y:400,width:250,height:100};
plugin.data={spatialLayouts:{'Pages/Session.md':{boxes:[box,other]}},spatialDrafts:{'Pages/Session.md':{main:{value:'Unsaved draft'}}}};
const before=JSON.stringify(plugin.data);
const profile={version:'v1',pages:{'Pages/Session.md':{boxes:{main:metrics,missing:metrics}},'Missing.md':{boxes:{main:metrics}}}};
plugin.applySpatialTypographyProfile(profile);
assert.equal(saved,1);assert.equal(box.typography,metrics);assert(!other.typography);
const retained=JSON.parse(JSON.stringify(plugin.data));delete retained.spatialLayouts['Pages/Session.md'].boxes[0].typography;delete retained.spatialTypographyImportVersion;
assert.equal(JSON.stringify(retained),before,'restoring typography cannot move user boxes, replace their size, change hierarchy or discard drafts');
assert.equal(width(box),626,'original text width excludes the editor frame and padding');assert.equal(width(other),250,'new free-form boxes keep their existing width semantics');
box.typography={fontSizePt:16,lineHeightPt:20};plugin.applySpatialTypographyProfile(profile);assert.equal(box.typography.fontSizePt,16,'an already applied import does not overwrite later changes');
console.log('PASS: original fonts and widths, empty-line recovery, coloured/link paragraph matching, safe edited-paragraph fallback, per-paragraph sizes, one-time profile merge without moving boxes or losing drafts.');
