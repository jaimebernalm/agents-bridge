import {expect,test} from 'bun:test';
import {readLanguage} from '../src/lib/i18n';
import {readDark} from '../src/lib/theme';

const stored=(values:Record<string,string>)=>({getItem:(key:string)=>values[key]??null});
const failing={getItem:()=>{throw new Error('Storage blocked')}};

test('the panel starts in English whatever the system language, until the person picks one',()=>{
 expect(readLanguage()).toBe('en');
 expect(readLanguage(stored({}))).toBe('en');
 expect(readLanguage(stored({'cc-cdx-language':'es'}))).toBe('es');
 expect(readLanguage(stored({'cc-cdx-language':'fr'}))).toBe('en');
 expect(readLanguage(failing)).toBe('en');
});
test('the panel starts light whatever the system theme, until the person picks dark',()=>{
 expect(readDark()).toBe(false);
 expect(readDark(stored({}))).toBe(false);
 expect(readDark(stored({theme:'dark'}))).toBe(true);
 expect(readDark(stored({theme:'light'}))).toBe(false);
 expect(readDark(failing)).toBe(false);
});
