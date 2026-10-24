const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
const text=fs.readFileSync(path.join(root,'shared/inline-text-formats.js'),'utf8')+fs.readFileSync(path.join(root,'shared/color-edit.js'),'utf8');
const context={require(){},console};vm.createContext(context);
vm.runInContext(text+'\nthis.api={notebookImportedFormats,notebookColorEdit};',context);
const {notebookImportedFormats:parse,notebookColorEdit:change}=context.api;
const plain=value=>value.replace(/<span[^>]*>|<\/span>/g,'');
const apply=(value,from,to,preset)=>{const edit=change(value,from,to,preset.color,preset);return value.slice(0,edit.from)+edit.insert+value.slice(edit.to);};
const presets=[{color:'#5B9BD5',bold:true,size:null},{color:'#FF0000',bold:true,size:null},{color:'#FF0000',bold:true,size:'1.2em'}];
for(const preset of presets){
 const result=apply('Eine wichtige Notiz.',5,13,preset),runs=parse(result);
 assert.equal(plain(result),'Eine wichtige Notiz.');assert.equal(runs.length,1);
 assert.equal(runs[0].color,preset.color);assert(runs[0].style.includes('font-weight:700'));
 assert.equal(runs[0].style.includes('font-size:1.2em'),!!preset.size);
}
const source='[[Wissen/Ziel|Begriff]]';
let result=apply(source,source.indexOf('Begriff'),source.indexOf('Begriff')+7,presets[2]);
assert.equal(plain(result),source);assert(result.includes('>'+source+'</span>'));
for(const preset of [presets[0],presets[1],presets[2],presets[0]]){
 const from=result.indexOf('>')+1,to=result.lastIndexOf('</span>');result=apply(result,from,to,preset);
 assert.equal(parse(result).length,1,'changing presets cannot nest wrappers');assert.equal(plain(result),source);
 assert.equal(parse(result)[0].style.includes('font-size:1.2em'),!!preset.size);
}
const old='<span class="tn-import-format" data-tn-color="#5B9BD5" style="color:#5B9BD5;font-weight:700">Alles wichtig</span>';
const partial=apply(old,old.indexOf('wichtig'),old.indexOf('wichtig')+7,presets[2]);
assert.equal(plain(partial),'Alles wichtig');assert.equal(parse(partial).length,2);assert(!/<span[^>]*>[^<]*<span/.test(partial));
const multi='# Überschrift\n\n- **Notiz**\n- Zweite Zeile';
assert.equal(plain(apply(multi,0,multi.length,presets[2])),multi);
for(const code of ['`Code`','---\ncreated: test\n---\n','```\nCode\n```'])assert.throws(()=>apply(code,0,code.length,presets[0]));
assert.throws(()=>change('Text',0,4,'red'));assert.throws(()=>change('Text',0,4,'#FF0000',{size:'100em'}));
assert.equal(parse(result.replace('font-weight:700','font-weight:700;position:fixed')).length,0);

const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
assert.equal(manifest.id,'classic-notebook');
assert(fs.readFileSync(path.join(root,'main.js'),'utf8').includes("groups: [], order: ['']"),'default sections must be empty');
console.log('PASS: portable text formats, presets, partial/multiline selections, preserved links, protected source and empty vault defaults.');
