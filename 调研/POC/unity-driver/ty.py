import subprocess,sys,json,os
sys.stdout.reconfigure(encoding='utf-8')
D=os.path.dirname(os.path.abspath(__file__))
s=open(os.path.join(D,'type_tpl.cs'),encoding='utf-8').read().replace('__PATH__',sys.argv[1]).replace('__TEXT__',sys.argv[2])
p=os.path.join(D,'_t.cs'); open(p,'w',encoding='utf-8').write(s)
r=subprocess.run([sys.executable,'-I',os.path.join(D,'umcp.py'),'code',p,'3000'],capture_output=True,text=True,encoding='utf-8').stdout
try: print(json.loads(r[r.find('{'):])['data']['result'])
except Exception: print(r)
