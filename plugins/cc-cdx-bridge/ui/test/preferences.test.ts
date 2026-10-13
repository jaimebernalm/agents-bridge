import {expect,test} from 'bun:test';
import {pagePreferences} from '../src/lib/preferences';

const page=(lang:string,classes:string[]=[])=>({lang,classList:{contains:(name:string)=>classes.includes(name)}});

test('the panel opens with the choice the service saved, and English and light until the person picks',()=>{
 expect(pagePreferences()).toEqual({language:'en',theme:'light'});
 expect(pagePreferences(page('en'))).toEqual({language:'en',theme:'light'});
 expect(pagePreferences(page('es',['dark']))).toEqual({language:'es',theme:'dark'});
 expect(pagePreferences(page('fr',['theme-transition']))).toEqual({language:'en',theme:'light'});
});
