"""python sw.py read|click <页面基础路径> 行名1 [行名2…]"""
import subprocess,sys,json,os,time
sys.stdout.reconfigure(encoding='utf-8')
D=os.path.dirname(os.path.abspath(__file__))
s=open(os.path.join(D,'sw_tpl.cs'),encoding='utf-8').read().replace('__MODE__',sys.argv[1]).replace('__BASE__',sys.argv[2]).replace('__NAMES__',','.join('"%s"'%n for n in sys.argv[3:]))
p=os.path.join(D,'_sw.cs'); open(p,'w',encoding='utf-8').write(s)
r=subprocess.run([sys.executable,'-I',os.path.join(D,'umcp.py'),'code',p,'4000'],capture_output=True,text=True,encoding='utf-8').stdout
try: print(json.loads(r[r.find('{'):])['data']['result'])
except Exception: print(r)
if sys.argv[1]=='click': time.sleep(1.5)
