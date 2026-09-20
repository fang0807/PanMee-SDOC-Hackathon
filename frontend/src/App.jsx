import { useState, useEffect } from 'react'

function App() {
  const [page, setPage] = useState('Dashboard')
  const [file, setFile] = useState(null)
  const [documents, setDocuments] = useState([])
  const [processing, setProcessing] = useState(false)
  const [workflowStep, setWorkflowStep] = useState(0)
  const [selectedDocument, setSelectedDocument] = useState(null)

  // ================= UPLOAD =================

  const handleFileChange = (event) => {
    const selectedFiles = Array.from(event.target.files)

    if (selectedFiles.length === 0) return

    const newDocuments = selectedFiles.map((selectedFile) => ({
      id: Date.now() + Math.random(),
      name: selectedFile.name,
      size: selectedFile.size,
      type: getDocumentType(selectedFile.name),
      status: 'Ready',
    }))

    setDocuments((prev) => [...prev, ...newDocuments])
    setFile(selectedFiles[0])
  }


  // ================= DOCUMENT TYPE =================

  const getDocumentType = (filename) => {
    const name = filename.toLowerCase()

    if (name.includes('invoice')) {
      return 'Commercial Invoice'
    }

    if (name.includes('packing')) {
      return 'Packing List'
    }

    if (
      name.includes('bill') ||
      name.includes('bol') ||
      name.includes('lading')
    ) {
      return 'Bill of Lading'
    }

    if (
      name.includes('purchase') ||
      name.includes('po')
    ) {
      return 'Purchase Order'
    }

    return 'Shipping Document'
  }


  // ================= DELETE =================

  const handleDelete = (id) => {
    setDocuments((prev) =>
      prev.filter((document) => document.id !== id)
    )
  }


  // ================= WORKFLOW =================

  const handleProcess = () => {
    if (documents.length === 0) return

    setProcessing(true)
    setWorkflowStep(1)
    setPage('Workflow')
  }


  useEffect(() => {
    if (!processing) return

    if (workflowStep >= 4) return

    const timer = setTimeout(() => {
      setWorkflowStep((prev) => prev + 1)
    }, 2000)

    return () => clearTimeout(timer)
  }, [processing, workflowStep])


  // ================= NEW DOCUMENT =================

  const handleNewDocument = () => {
    setProcessing(false)
    setWorkflowStep(0)
    setPage('Documents')
  }


  // ================= FILE SIZE =================

  const formatFileSize = (bytes) => {
    if (bytes < 1024) {
      return `${bytes} B`
    }

    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`
    }

    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }


  // ================= MOCK EXTRACTION =================

  const getExtractedData = (document) => {

    if (!document) {
      return {
        invoiceNumber: 'INV-2026-001',
        supplier: 'ABC Trading Sdn Bhd',
        buyer: 'SmartDoc Logistics',
        quantity: '500 units',
        amount: 'USD 25,000',
        container: 'ABCD1234567',
      }
    }


    if (document.type === 'Commercial Invoice') {
      return {
        invoiceNumber: 'INV-2026-001',
        supplier: 'ABC Trading Sdn Bhd',
        buyer: 'SmartDoc Logistics',
        quantity: '500 units',
        amount: 'USD 25,000',
        container: 'ABCD1234567',
      }
    }


    if (document.type === 'Packing List') {
      return {
        invoiceNumber: 'PL-2026-001',
        supplier: 'ABC Trading Sdn Bhd',
        buyer: 'SmartDoc Logistics',
        quantity: '480 units',
        amount: 'USD 24,000',
        container: 'ABCD1234567',
      }
    }


    if (document.type === 'Bill of Lading') {
      return {
        invoiceNumber: 'BL-2026-001',
        supplier: 'ABC Trading Sdn Bhd',
        buyer: 'SmartDoc Logistics',
        quantity: '500 units',
        amount: 'USD 25,000',
        container: 'ABCD1234567',
      }
    }


    return {
      invoiceNumber: 'DOC-2026-001',
      supplier: 'ABC Trading Sdn Bhd',
      buyer: 'SmartDoc Logistics',
      quantity: '500 units',
      amount: 'USD 25,000',
      container: 'ABCD1234567',
    }
  }


  // ================= CLOSE PREVIEW =================

  const closePreview = () => {
    setSelectedDocument(null)
  }


  return (
    <div className="app">

      {/* ================= SIDEBAR ================= */}

      <aside className="sidebar">

        <div className="logo">
          SmartDoc
        </div>

        <nav>

          <button
            className={page === 'Dashboard' ? 'active' : ''}
            onClick={() => setPage('Dashboard')}
          >
            Dashboard
          </button>

          <button
            className={page === 'Documents' ? 'active' : ''}
            onClick={() => setPage('Documents')}
          >
            Documents
          </button>

          <button
            className={page === 'Workflow' ? 'active' : ''}
            onClick={() => setPage('Workflow')}
          >
            Workflow
          </button>

          <button
            className={page === 'Audit' ? 'active' : ''}
            onClick={() => setPage('Audit')}
          >
            Audit
          </button>

          <button
            className={page === 'History' ? 'active' : ''}
            onClick={() => setPage('History')}
          >
            History
          </button>

        </nav>

      </aside>


      {/* ================= MAIN ================= */}

      <main className="main">


        {/* ================= DASHBOARD ================= */}

        {page === 'Dashboard' && (
          <>

            <div className="page-header">

              <h1>
                Smart Document Workflow
              </h1>

              <p>
                AI Shipping Document Auditor
              </p>

            </div>


            <div className="dashboard-grid">

              <div className="dashboard-card">

                <h3>
                  Documents
                </h3>

                <div className="card-number">
                  {documents.length}
                </div>

                <p>
                  Documents uploaded
                </p>

              </div>


              <div className="dashboard-card">

                <h3>
                  Processing
                </h3>

                <div className="card-number">
                  {processing ? '1' : '0'}
                </div>

                <p>
                  Active workflows
                </p>

              </div>


              <div className="dashboard-card">

                <h3>
                  Audit Status
                </h3>

                <div className="card-status">
                  {workflowStep >= 4 ? 'Review' : 'Pending'}
                </div>

                <p>
                  Current audit status
                </p>

              </div>

            </div>


            <div className="welcome-box">

              <h2>
                Welcome to SmartDoc
              </h2>

              <p>
                Upload your shipping documents and let SmartDoc
                classify, extract, understand and validate
                your documents automatically.
              </p>

              <button
                onClick={() => setPage('Documents')}
              >
                Upload Documents
              </button>

            </div>

          </>
        )}


        {/* ================= DOCUMENTS ================= */}

        {page === 'Documents' && (
          <>

            <div className="page-header">

              <h1>
                Documents
              </h1>

              <p>
                Upload and manage your shipping documents.
              </p>

            </div>


            {/* UPLOAD */}

            <div className="upload-box">

              <div className="upload-icon">
                📄
              </div>

              <h2>
                Upload Shipping Documents
              </h2>

              <p>
                Upload Invoice, Packing List, Bill of Lading
                or Purchase Order.
              </p>

              <p className="upload-format">
                Supported formats: PDF, PNG, JPG
              </p>


              <label className="upload-button">

                + Choose Files

                <input
                  type="file"
                  multiple
                  accept=".pdf,.png,.jpg,.jpeg"
                  onChange={handleFileChange}
                />

              </label>

            </div>


            {/* DOCUMENT LIST */}

            <div className="document-section">

              <div className="section-header">

                <div>

                  <h2>
                    Uploaded Documents
                  </h2>

                  <p>
                    {documents.length} document
                    {documents.length !== 1 ? 's' : ''}
                  </p>

                </div>


                {documents.length > 0 && (

                  <button
                    className="workflow-button"
                    onClick={handleProcess}
                  >
                    Start Document Workflow →
                  </button>

                )}

              </div>


              {documents.length === 0 ? (

                <div className="empty-documents">

                  <div className="empty-icon">
                    📁
                  </div>

                  <h3>
                    No documents uploaded
                  </h3>

                  <p>
                    Upload your shipping documents to begin.
                  </p>

                </div>

              ) : (

                <div className="document-list">

                  {documents.map((document) => (

                    <div
                      className="document-item"
                      key={document.id}
                    >

                      <div className="document-icon">
                        📄
                      </div>


                      <div className="document-info">

                        <strong>
                          {document.name}
                        </strong>

                        <p>
                          {document.type}
                          {' • '}
                          {formatFileSize(document.size)}
                        </p>

                      </div>


                      <div className="document-status">

                        <span className="ready-status">
                          ● {document.status}
                        </span>

                      </div>


                      <button
                        className="view-button"
                        onClick={() =>
                          setSelectedDocument(document)
                        }
                      >
                        View
                      </button>


                      <button
                        className="delete-button"
                        onClick={() =>
                          handleDelete(document.id)
                        }
                      >
                        Delete
                      </button>

                    </div>

                  ))}

                </div>

              )}

            </div>

          </>
        )}


        {/* ================= WORKFLOW ================= */}

        {page === 'Workflow' && (
          <>

            <div className="page-header">

              <h1>
                AI Document Workflow
              </h1>

              <p>
                SmartDoc is analyzing your shipping documents.
              </p>

            </div>


            <div className="workflow-file">

              <span>
                📄
              </span>

              <div>

                <strong>
                  {documents.length} shipping document
                  {documents.length !== 1 ? 's' : ''}
                </strong>

                <p>
                  Ready for AI analysis
                </p>

              </div>

            </div>


            <div className="workflow-box">


              <div className="workflow-step">

                <div className="workflow-info">

                  <div className="step-number">
                    1
                  </div>

                  <div>

                    <strong>
                      Document Classification
                    </strong>

                    <p>
                      Identify the type of shipping document
                    </p>

                  </div>

                </div>


                <span
                  className={
                    workflowStep >= 1
                      ? 'status completed'
                      : 'status waiting'
                  }
                >
                  {workflowStep >= 1
                    ? '✓ Completed'
                    : '○ Waiting'}
                </span>

              </div>


              <div className="workflow-step">

                <div className="workflow-info">

                  <div className="step-number">
                    2
                  </div>

                  <div>

                    <strong>
                      Data Extraction
                    </strong>

                    <p>
                      Extract important information from documents
                    </p>

                  </div>

                </div>


                <span
                  className={
                    workflowStep >= 2
                      ? 'status completed'
                      : workflowStep === 1
                        ? 'status processing'
                        : 'status waiting'
                  }
                >
                  {workflowStep >= 2
                    ? '✓ Completed'
                    : workflowStep === 1
                      ? '⟳ Processing...'
                      : '○ Waiting'}
                </span>

              </div>


              <div className="workflow-step">

                <div className="workflow-info">

                  <div className="step-number">
                    3
                  </div>

                  <div>

                    <strong>
                      Semantic Understanding
                    </strong>

                    <p>
                      Understand relationships between extracted data
                    </p>

                  </div>

                </div>


                <span
                  className={
                    workflowStep >= 3
                      ? 'status completed'
                      : workflowStep === 2
                        ? 'status processing'
                        : 'status waiting'
                  }
                >
                  {workflowStep >= 3
                    ? '✓ Completed'
                    : workflowStep === 2
                      ? '⟳ Processing...'
                      : '○ Waiting'}
                </span>

              </div>


              <div className="workflow-step">

                <div className="workflow-info">

                  <div className="step-number">
                    4
                  </div>

                  <div>

                    <strong>
                      Document Validation
                    </strong>

                    <p>
                      Compare information across shipping documents
                    </p>

                  </div>

                </div>


                <span
                  className={
                    workflowStep >= 4
                      ? 'status completed'
                      : workflowStep === 3
                        ? 'status processing'
                        : 'status waiting'
                  }
                >
                  {workflowStep >= 4
                    ? '✓ Completed'
                    : workflowStep === 3
                      ? '⟳ Processing...'
                      : '○ Waiting'}
                </span>

              </div>

            </div>


            {processing && workflowStep < 4 && (

              <div className="processing-message">

                <div className="loading-dot">
                  ●
                </div>

                <div>

                  <strong>
                    AI processing in progress...
                  </strong>

                  <p>
                    SmartDoc is analyzing your documents.
                  </p>

                </div>

              </div>

            )}


            {workflowStep >= 4 && (

              <div className="audit-ready">

                <div>

                  <h2>
                    ✓ Document Processing Completed
                  </h2>

                  <p>
                    All uploaded documents have been processed.
                  </p>

                </div>


                <button
                  onClick={() => setPage('Audit')}
                >
                  View AI Audit Result
                </button>

              </div>

            )}

          </>
        )}


        {/* ================= AUDIT ================= */}

        {page === 'Audit' && (
          <>

            <div className="page-header">

              <h1>
                AI Audit Result
              </h1>

              <p>
                SmartDoc document compliance analysis.
              </p>

            </div>


            <div className="audit-overview">

              <div className="audit-overview-left">

                <div className="review-icon">
                  ⚠
                </div>

                <div>

                  <h2>
                    Review Required
                  </h2>

                  <p>
                    SmartDoc detected 2 potential discrepancies.
                  </p>

                </div>

              </div>


              <div className="risk-box">

                <span>
                  Risk Level
                </span>

                <strong>
                  MEDIUM
                </strong>

              </div>

            </div>


            <div className="audit-cards">

              <div className="audit-card">

                <span>
                  Issues Detected
                </span>

                <strong>
                  2
                </strong>

              </div>


              <div className="audit-card">

                <span>
                  Checks Passed
                </span>

                <strong>
                  1
                </strong>

              </div>


              <div className="audit-card">

                <span>
                  AI Confidence
                </span>

                <strong>
                  94%
                </strong>

              </div>

            </div>


            {/* COMPARISON */}

            <div className="audit-section">

              <div className="section-title">

                <h2>
                  Document Comparison
                </h2>

                <p>
                  Cross-document field validation
                </p>

              </div>


              <div className="comparison-table">

                <div className="table-row table-header">

                  <div>
                    Field
                  </div>

                  <div>
                    Commercial Invoice
                  </div>

                  <div>
                    Packing List
                  </div>

                  <div>
                    Status
                  </div>

                </div>


                <div className="table-row">

                  <div>
                    Quantity
                  </div>

                  <div>
                    500 units
                  </div>

                  <div>
                    480 units
                  </div>

                  <div className="table-warning">
                    ⚠ Mismatch
                  </div>

                </div>


                <div className="table-row">

                  <div>
                    Container Number
                  </div>

                  <div>
                    ABCD1234567
                  </div>

                  <div>
                    ABCD1234567
                  </div>

                  <div className="table-success">
                    ✓ Match
                  </div>

                </div>


                <div className="table-row">

                  <div>
                    Total Amount
                  </div>

                  <div>
                    USD 25,000
                  </div>

                  <div>
                    USD 24,000
                  </div>

                  <div className="table-warning">
                    ⚠ Mismatch
                  </div>

                </div>

              </div>

            </div>


            {/* ISSUES */}

            <div className="audit-section">

              <h2>
                Issues Detected
              </h2>


              <div className="issue-card">

                <div className="issue-icon">
                  ⚠
                </div>

                <div>

                  <h3>
                    Quantity Mismatch
                  </h3>

                  <p>
                    Commercial Invoice shows 500 units,
                    while Packing List shows 480 units.
                  </p>

                  <span className="issue-detail">
                    Difference: 20 units
                  </span>

                </div>

              </div>


              <div className="issue-card">

                <div className="issue-icon">
                  ⚠
                </div>

                <div>

                  <h3>
                    Amount Mismatch
                  </h3>

                  <p>
                    Invoice total is USD 25,000,
                    while the calculated amount is USD 24,000.
                  </p>

                  <span className="issue-detail">
                    Difference: USD 1,000
                  </span>

                </div>

              </div>


              <div className="issue-card success">

                <div className="issue-icon">
                  ✓
                </div>

                <div>

                  <h3>
                    Container Number Matched
                  </h3>

                  <p>
                    Container number is consistent
                    across the submitted documents.
                  </p>

                </div>

              </div>

            </div>


            {/* AI ANALYSIS */}

            <div className="audit-section">

              <h2>
                AI Analysis
              </h2>


              <div className="ai-analysis">

                <div className="ai-label">
                  AI
                </div>

                <p>
                  Two potential discrepancies were detected
                  during cross-document validation. The
                  quantity and total amount require manual
                  review before the shipment is processed.
                </p>

              </div>


              <div className="confidence-section">

                <div className="confidence-header">

                  <span>
                    AI Confidence
                  </span>

                  <strong>
                    94%
                  </strong>

                </div>


                <div className="confidence-bar">

                  <div className="confidence-progress">
                  </div>

                </div>

              </div>

            </div>


            <button
              className="new-document-button"
              onClick={handleNewDocument}
            >
              ← Process Another Document
            </button>

          </>
        )}


        {/* ================= HISTORY ================= */}

        {page === 'History' && (
          <>

            <div className="page-header">

              <h1>
                History
              </h1>

              <p>
                Previous audit records.
              </p>

            </div>


            <div className="history-box">

              <div className="history-item">

                <div>

                  <strong>
                    Shipping Document Audit
                  </strong>

                  <p>
                    Commercial Invoice
                  </p>

                </div>

                <span>
                  Review Required
                </span>

              </div>


              <div className="history-item">

                <div>

                  <strong>
                    Shipping Document Audit
                  </strong>

                  <p>
                    Packing List
                  </p>

                </div>

                <span className="history-success">
                  Passed
                </span>

              </div>

            </div>

          </>
        )}

      </main>


      {/* ================= DOCUMENT PREVIEW MODAL ================= */}

      {selectedDocument && (

        <div
          className="modal-overlay"
          onClick={closePreview}
        >

          <div
            className="document-modal"
            onClick={(event) => event.stopPropagation()}
          >

            <div className="modal-header">

              <div>

                <h2>
                  Document Preview
                </h2>

                <p>
                  {selectedDocument.name}
                </p>

              </div>


              <button
                className="close-button"
                onClick={closePreview}
              >
                ×
              </button>

            </div>


            <div className="modal-content">


              {/* DOCUMENT PREVIEW */}

              <div className="document-preview">

                <div className="preview-toolbar">

                  <span>
                    📄
                  </span>

                  <strong>
                    {selectedDocument.type}
                  </strong>

                </div>


                <div className="fake-document">

                  <div className="fake-document-header">

                    <strong>
                      {selectedDocument.type}
                    </strong>

                    <span>
                      SMARTDOC
                    </span>

                  </div>


                  <div className="fake-line long"></div>
                  <div className="fake-line medium"></div>

                  <div className="fake-document-box">

                    <div>
                      DOCUMENT NUMBER
                    </div>

                    <strong>
                      INV-2026-001
                    </strong>

                  </div>


                  <div className="fake-line long"></div>
                  <div className="fake-line short"></div>
                  <div className="fake-line medium"></div>
                  <div className="fake-line long"></div>


                  <div className="fake-document-total">

                    <span>
                      TOTAL
                    </span>

                    <strong>
                      USD 25,000
                    </strong>

                  </div>

                </div>

              </div>


              {/* EXTRACTED DATA */}

              <div className="extracted-panel">

                <div className="extracted-header">

                  <div className="ai-label">
                    AI
                  </div>

                  <div>

                    <h3>
                      AI Extracted Data
                    </h3>

                    <p>
                      Structured information detected
                    </p>

                  </div>

                </div>


                <div className="extracted-list">

                  <div className="extracted-item">

                    <span>
                      Invoice Number
                    </span>

                    <strong>
                      {getExtractedData(selectedDocument).invoiceNumber}
                    </strong>

                  </div>


                  <div className="extracted-item">

                    <span>
                      Supplier
                    </span>

                    <strong>
                      {getExtractedData(selectedDocument).supplier}
                    </strong>

                  </div>


                  <div className="extracted-item">

                    <span>
                      Buyer
                    </span>

                    <strong>
                      {getExtractedData(selectedDocument).buyer}
                    </strong>

                  </div>


                  <div className="extracted-item">

                    <span>
                      Quantity
                    </span>

                    <strong>
                      {getExtractedData(selectedDocument).quantity}
                    </strong>

                  </div>


                  <div className="extracted-item">

                    <span>
                      Total Amount
                    </span>

                    <strong>
                      {getExtractedData(selectedDocument).amount}
                    </strong>

                  </div>


                  <div className="extracted-item">

                    <span>
                      Container Number
                    </span>

                    <strong>
                      {getExtractedData(selectedDocument).container}
                    </strong>

                  </div>

                </div>


                <div className="extraction-confidence">

                  <span>
                    Extraction Confidence
                  </span>

                  <strong>
                    96%
                  </strong>

                </div>

              </div>

            </div>

          </div>

        </div>

      )}

    </div>
  )
}

export default App