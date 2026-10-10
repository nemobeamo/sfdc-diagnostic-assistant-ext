import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {inlineHelp} from '../extension/core/inline-help.js';
test('popup and review expose all shared help topics inline',async()=>{
  for(const page of ['popup','review']){
    const html=await readFile(new URL('../extension/'+page+'.html',import.meta.url),'utf8');
    for(const topic of Object.keys(inlineHelp)) assert.ok(html.includes('id="'+topic+'Help"'),page+': '+topic);
  }
});
test('help renders readable lists and safe reference links without parsing HTML',async()=>{
  function element(tag){return {tag,children:[],append(...children){this.children.push(...children);}};}
  const source=(await readFile(new URL('../extension/core/inline-help.js',import.meta.url),'utf8')).replace(/export /g,'');
  const context=vm.createContext({document:{createElement:element},target:element('div')});
  vm.runInContext(source+"\nrenderInlineHelp(target,'requirements');",context);
  const target=context.target;
  assert.equal(target.children[0].tag,'p');
  assert.equal(target.children[1].tag,'section');
  assert.equal(target.children[1].className,'requiredPermissions');
  assert.equal(target.children[1].children[1].tag,'ul');
  assert.equal(target.children[1].children[1].children.length,2);
  assert.equal(target.children[3].tag,'ul');
  assert.equal(target.children[3].children.length,inlineHelp.requirements.items.length);
  for(const paragraph of target.children.slice(4)){
    const link=paragraph.children[0];
    assert.equal(link.tag,'a'); assert.equal(link.target,'_blank');
    assert.equal(link.rel,'noopener noreferrer');
    assert.equal(new URL(link.href).hostname,'help.salesforce.com');
  }
  context.target=element('div');
  vm.runInContext("renderInlineHelp(target,'apex')",context);
  assert.equal(context.target.children[1].tag,'ol');
});
