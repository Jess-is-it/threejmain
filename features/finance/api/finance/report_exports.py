"""Spreadsheet-safe UTF-8 records with their report context and exact amounts."""
import csv
import io
import json
import re


def safe_cell(value):
    if value is None:return ''
    if isinstance(value,(dict,list)):value=json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':'))
    text=str(value)
    # Numeric strings are exact source amounts, never formulas. Text beginning
    # with a formula character (including after whitespace) is explicitly escaped.
    if not re.fullmatch(r'-?\d+(?:\.\d+)?',text) and (text.lstrip().startswith(('=','+','-','@')) or text.startswith(('\t','\r','\n'))):
        text="'"+text
    return text


def output_rows(report):
    rows=[]
    def add(section,record):rows.append({'section':section,**record})
    for key in ('period','asOf','basis','expenseBasis','groupBy','scope','status','reasonCodes','missingDependencies','currency','timeZone','generatedAt','policyVersion','knowledgeCutoff','ledgerFingerprint','sourceWatermarks','requestedBy','periodState','publicationVersion','publicationClosedBy'):
        if key in report:add('report context',{'field':key,'value':report[key]})
    for name,metric in report.get('metrics',{}).items():add('metrics',{'field':name,**metric})
    for name,value in report.items():
        if isinstance(value,(str,int,float)) and name not in ('asOf','basis','expenseBasis','groupBy','scope','status','currency','timeZone','generatedAt','policyVersion','knowledgeCutoff','ledgerFingerprint','requestedBy','periodState','publicationVersion','publicationClosedBy'):
            add('summary',{'field':name,'value':value})
    for section in ('controlledCash','flows','recordedClassTotals','aging','counts'):
        for name,value in report.get(section,{}).items():add(section,{'field':name,'value':value})
    for section in ('accounts','groups','rows','transactions','accountTransactions','events','openingLines','closingLines','monthlyRateRows'):
        for record in report.get(section,[]):add(section,record)
    for record in report.get('items',[]):
        for line in record.get('lines',[]):add('journal lines',{**{k:v for k,v in record.items() if k!='lines'},**line})
    for section in ('receiptMonth','billingPeriodSettlement'):
        if report.get(section):
            for row in output_rows(report[section]):rows.append({**row,'section':section+' / '+row['section']})
    return rows


def report_csv(report):
    rows=output_rows(report)
    fields=list(dict.fromkeys(key for row in rows for key in row)) or ['section','field','value']
    buffer=io.StringIO(newline='');writer=csv.DictWriter(buffer,fieldnames=fields,lineterminator='\r\n')
    writer.writeheader()
    writer.writerows({key:safe_cell(value) for key,value in row.items()} for row in rows)
    return '\ufeff'+buffer.getvalue()
